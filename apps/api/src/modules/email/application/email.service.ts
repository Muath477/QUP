import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { EmailNotConfigured, EmailUnavailable } from "../domain/email.errors.js";
import { deliveryKind, type EmailTemplate, renderEmail } from "../domain/email-templates.js";
import {
  EMAIL_DELIVERY_STORE,
  EMAIL_SENDER,
  type EmailDeliveryStore,
  type EmailSender,
  EmailSendFailed,
} from "../domain/ports.js";
import type { DeliverOutcome, OtpPurpose, TransactionalEmail } from "../email.contract.js";

/**
 * A code is waited for by a person at a screen: a couple of quick tries, not
 * the minutes of backoff a receipt may take. The provider's Idempotency-Key
 * makes a try after an unanswered one safe — it cannot mail the code twice.
 */
const CODE_SEND_ATTEMPTS = 2;
const CODE_RETRY_DELAY_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What is logged and stored about a failure: where it failed, never the message. */
function describeFailure(error: EmailSendFailed): string {
  return `${error.operation} ${error.status ?? "no-response"} ${error.providerCode ?? ""}`.trim();
}

@Injectable()
export class EmailService implements TransactionalEmail {
  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender | null,
    @Inject(EMAIL_DELIVERY_STORE) private readonly store: EmailDeliveryStore,
    @InjectPinoLogger(EmailService.name) private readonly logger: PinoLogger,
  ) {}

  get enabled(): boolean {
    return this.sender !== null;
  }

  async sendCode(input: {
    userId: string;
    to: string;
    purpose: OtpPurpose;
    code: string;
    validForMinutes: number;
    codeId: string;
  }): Promise<void> {
    const template: EmailTemplate = {
      kind: "OTP",
      purpose: input.purpose,
      code: input.code,
      validForMinutes: input.validForMinutes,
    };
    for (let attempt = 1; attempt <= CODE_SEND_ATTEMPTS; attempt += 1) {
      try {
        const outcome = await this.deliver({
          userId: input.userId,
          to: input.to,
          template,
          idempotencyKey: `otp:${input.codeId}`,
        });
        if (outcome === "REJECTED") throw new EmailUnavailable();
        return;
      } catch (error) {
        if (error instanceof EmailNotConfigured || error instanceof EmailUnavailable) throw error;
        if (!(error instanceof EmailSendFailed)) throw error;
        // deliver() has already logged a failure; a retryable one is tried once more.
        if (attempt === CODE_SEND_ATTEMPTS) throw new EmailUnavailable();
        await sleep(CODE_RETRY_DELAY_MS);
      }
    }
    throw new EmailUnavailable();
  }

  async deliver(input: {
    userId: string | null;
    to: string;
    template: EmailTemplate;
    idempotencyKey: string;
  }): Promise<DeliverOutcome> {
    const sender = this.requireSender();
    const delivery = await this.store.begin({
      userId: input.userId,
      kind: deliveryKind(input.template),
      toAddress: input.to,
      provider: sender.name,
      idempotencyKey: input.idempotencyKey,
    });
    // An earlier run already got it to the provider, or gave up on it.
    if (delivery.status !== "QUEUED") return "ALREADY_HANDLED";

    const message = renderEmail(input.template);
    try {
      const { messageId } = await sender.send({
        to: input.to,
        idempotencyKey: input.idempotencyKey,
        ...message,
      });
      await this.store.markSent(delivery.id, messageId, new Date());
      return "SENT";
    } catch (error) {
      if (!(error instanceof EmailSendFailed)) throw error;
      const log = {
        deliveryId: delivery.id,
        kind: deliveryKind(input.template),
        providerStatus: error.status,
        providerCode: error.providerCode,
        retryable: error.retryable,
      };
      if (error.retryable) {
        await this.store.markAttemptFailed(delivery.id, describeFailure(error));
        this.logger.warn(log, "Email send failed; may be retried");
        throw error;
      }
      await this.store.markFailed(delivery.id, describeFailure(error));
      this.logger.error(log, "Email rejected by the provider; not retried");
      return "REJECTED";
    }
  }

  private requireSender(): EmailSender {
    if (!this.sender) throw new EmailNotConfigured();
    return this.sender;
  }
}
