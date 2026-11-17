import type { EmailDeliveryStatus, ProviderReportedStatus } from "./delivery-status.js";

/**
 * Ports of the email module. The domain and application code know "send this
 * message" and "record what happened"; only the adapters know SNDR or Drizzle.
 */

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
}

export interface OutgoingEmail extends EmailMessage {
  to: string;
  /** The provider's Idempotency-Key: a repeat with the same key sends nothing new. */
  idempotencyKey: string;
}

export interface EmailSender {
  /** Stable lower-case name: stored on deliveries and used in the webhook path. */
  readonly name: string;
  /** Throws EmailSendFailed. */
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

/** A provider call that failed. Safe to log; never carries credentials or the message. */
export class EmailSendFailed extends Error {
  constructor(
    readonly operation: string,
    /** HTTP status, or null when the provider was not reached. */
    readonly status: number | null,
    readonly providerCode: string | null,
    /** Whether trying the same email again can succeed (outage, throttling) or cannot (rejected). */
    readonly retryable: boolean,
  ) {
    super(`Email provider ${operation} failed (${status ?? "no response"}).`);
    this.name = "EmailSendFailed";
  }
}

export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

export interface EmailDelivery {
  id: string;
  status: EmailDeliveryStatus;
  providerMessageId: string | null;
  attempts: number;
}

export interface EmailDeliveryStore {
  /**
   * The delivery for this idempotency key, created QUEUED when it is new — so
   * running the same logical email twice finds the first run's row.
   */
  begin(input: {
    userId: string | null;
    kind: string;
    toAddress: string;
    provider: string;
    idempotencyKey: string;
  }): Promise<EmailDelivery>;
  /** The provider accepted the message. */
  markSent(id: string, messageId: string, at: Date): Promise<void>;
  /** An attempt failed but may be retried: the delivery stays QUEUED. */
  markAttemptFailed(id: string, error: string): Promise<void>;
  /** An attempt failed for good. */
  markFailed(id: string, error: string): Promise<void>;
  /**
   * The provider reported what became of a message. Only moves forward (see
   * delivery-status.ts). Returns false when no delivery has that message id.
   */
  applyProviderStatus(
    provider: string,
    messageId: string,
    status: ProviderReportedStatus,
    detail: string | null,
  ): Promise<boolean>;
}

export const EMAIL_DELIVERY_STORE = Symbol("EMAIL_DELIVERY_STORE");
