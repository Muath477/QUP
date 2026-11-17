import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { z } from "zod";

import { APP_CONFIG, type AppConfig } from "../../../config/app-config.js";
import { statusFromSndrEvent } from "../domain/delivery-status.js";
import {
  EmailNotConfigured,
  EmailNotFound,
  EmailWebhookPayloadInvalid,
  EmailWebhookSignatureInvalid,
} from "../domain/email.errors.js";
import { EMAIL_DELIVERY_STORE, type EmailDeliveryStore } from "../domain/ports.js";
import { isValidSndrSignature } from "../infrastructure/sndr/sndr-signature.js";

const SIGNATURE_HEADER = "x-sndr-signature";
const PROVIDER = "sndr";
/**
 * An event about a message we have no record of is retried (answered 404) for
 * this long — our write of "sent" may simply not have landed yet — and then
 * dropped as someone else's mail (the same SNDR account may send other things).
 */
const UNKNOWN_MESSAGE_GRACE_MS = 10 * 60_000;

const sndrEvent = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created_at: z.string().optional(),
  data: z
    .object({
      email_id: z.string().min(1).optional(),
      reason: z.string().optional(),
    })
    .loose()
    .optional(),
});

/** What a webhook delivery led to — for the log line and for tests. */
export type EmailWebhookOutcome = "NOT_A_DELIVERY_EVENT" | "APPLIED" | "UNKNOWN_MESSAGE_DROPPED";

/**
 * SNDR reports what became of each message (delivered, bounced, failed). The
 * request is authenticated by its signature over the exact bytes received
 * (sndr-signature.ts) before anything in it is believed. A 2xx acknowledges;
 * any error makes SNDR retry with backoff, up to 12 times.
 */
@Injectable()
export class EmailWebhookService {
  constructor(
    @Inject(EMAIL_DELIVERY_STORE) private readonly store: EmailDeliveryStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectPinoLogger(EmailWebhookService.name) private readonly logger: PinoLogger,
  ) {}

  async handle(
    providerName: string,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
    now: Date = new Date(),
  ): Promise<EmailWebhookOutcome> {
    const secret = this.config.email.sndr?.webhookSecret;
    if (!secret || providerName !== PROVIDER) throw new EmailNotConfigured();
    if (!isValidSndrSignature(secret, rawBody, headers[SIGNATURE_HEADER], now)) {
      throw new EmailWebhookSignatureInvalid();
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new EmailWebhookPayloadInvalid();
    }
    const parsed = sndrEvent.safeParse(json);
    if (!parsed.success) throw new EmailWebhookPayloadInvalid();
    const event = parsed.data;

    const status = statusFromSndrEvent(event.type);
    const messageId = event.data?.email_id;
    // email.unsubscribed and friends: authentic, but not about a delivery.
    if (!status || !messageId) return "NOT_A_DELIVERY_EVENT";

    const known = await this.store.applyProviderStatus(
      PROVIDER,
      messageId,
      status,
      status === "DELIVERED" ? null : (event.data?.reason ?? event.type),
    );
    if (!known) {
      const createdAt = event.created_at ? Date.parse(event.created_at) : Number.NaN;
      const age = Number.isNaN(createdAt) ? 0 : now.getTime() - createdAt;
      if (age <= UNKNOWN_MESSAGE_GRACE_MS) throw new EmailNotFound();
      this.logger.info(
        { eventId: event.id, eventType: event.type },
        "Email event for an unknown message dropped",
      );
      return "UNKNOWN_MESSAGE_DROPPED";
    }
    if (status !== "DELIVERED") {
      // A bounce means the address is wrong or gone: worth knowing, never worth the address in a log.
      this.logger.warn({ eventId: event.id, eventType: event.type }, "Email was not delivered");
    }
    return "APPLIED";
  }
}
