import type { EmailTemplate, OtpPurpose } from "./domain/email-templates.js";

/**
 * Public contract of the email module (AGENTS.md §5): what other modules may
 * ask of it. Owned by the provider, so dependencies point one way:
 * auth → email, notifications → email, never back.
 */

export type { EmailTemplate, OtpPurpose };

/** What became of a `deliver` call. */
export type DeliverOutcome =
  /** The provider accepted the message. */
  | "SENT"
  /** An earlier run already got it to the provider; nothing was sent now. */
  | "ALREADY_HANDLED"
  /** The provider rejected it for a reason a retry cannot fix (bad address, suppressed…). */
  | "REJECTED";

export interface TransactionalEmail {
  /** Whether a provider is configured: without one, no email can be sent. */
  readonly enabled: boolean;

  /**
   * Sends a one-time code now, retrying briefly, because the person is waiting
   * for it. Throws EmailNotConfigured, or EmailUnavailable when it could not be
   * sent. `codeId` makes the send idempotent: a retry never mails the code twice.
   */
  sendCode(input: {
    userId: string;
    to: string;
    purpose: OtpPurpose;
    code: string;
    validForMinutes: number;
    codeId: string;
  }): Promise<void>;

  /**
   * Sends a notification once, however often it is called with the same
   * `idempotencyKey`. Throws EmailSendFailed (retryable) when the provider
   * could not take it right now — the caller retries later (the outbox relay).
   */
  deliver(input: {
    userId: string | null;
    to: string;
    template: EmailTemplate;
    idempotencyKey: string;
  }): Promise<DeliverOutcome>;
}

export const TRANSACTIONAL_EMAIL = Symbol("TRANSACTIONAL_EMAIL");

export { EmailNotConfigured, EmailUnavailable } from "./domain/email.errors.js";
