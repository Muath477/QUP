import { DomainError } from "../../../common/errors/domain-error.js";

export class EmailNotConfigured extends DomainError {
  readonly code = "EMAIL_NOT_CONFIGURED";
  readonly kind = "UNAVAILABLE";

  constructor() {
    super("Sending email is not available yet.");
  }
}

/** The provider could not take the message right now; nothing was sent. */
export class EmailUnavailable extends DomainError {
  readonly code = "EMAIL_UNAVAILABLE";
  readonly kind = "UNAVAILABLE";

  constructor() {
    super("The email could not be sent. Please try again in a moment.");
  }
}

/** Deliberately says nothing about why: the caller is unauthenticated. */
export class EmailWebhookSignatureInvalid extends DomainError {
  readonly code = "WEBHOOK_SIGNATURE_INVALID";
  readonly kind = "UNAUTHENTICATED";

  constructor() {
    super("The webhook signature is not valid.");
  }
}

export class EmailWebhookPayloadInvalid extends DomainError {
  readonly code = "WEBHOOK_PAYLOAD_INVALID";
  readonly kind = "INVALID_INPUT";

  constructor() {
    super("The webhook payload could not be understood.");
  }
}

/** Asks the provider to deliver the event again: we may not have recorded the send yet. */
export class EmailNotFound extends DomainError {
  readonly code = "EMAIL_NOT_FOUND";
  readonly kind = "NOT_FOUND";

  constructor() {
    super("No email with that id.");
  }
}
