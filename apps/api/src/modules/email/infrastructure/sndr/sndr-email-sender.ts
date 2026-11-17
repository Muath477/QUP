import { z } from "zod";

import { type EmailSender, EmailSendFailed, type OutgoingEmail } from "../../domain/ports.js";

/**
 * SNDR (sndr.sh) adapter, written against its published API: `POST /v1/send`
 * answers 202 `{ id, status: "queued", … }`; errors are `{ error: { code, … } }`.
 * Every response is validated here, so a contract change fails loudly at this
 * boundary. The sender's domain must be verified in SNDR, or it answers 4xx.
 */

export interface SndrConfig {
  apiKey: string;
  /** `hello@mail.example.com` or `Name <hello@mail.example.com>`. */
  from: string;
  replyTo: string | null;
  baseUrl: string;
  /** Per call; the default fits a waiting person. Tests shorten it. */
  timeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

const sendResponse = z.object({ id: z.string().min(1) });
const errorResponse = z.object({ error: z.object({ code: z.string() }) });

/**
 * Whether the same email can succeed on a later try. Throttling, a request
 * that is still in flight (409 on a repeated Idempotency-Key) and any 5xx
 * pass; a rejected address, an unverified domain or a bad key do not —
 * repeating those only delays the person who must fix them.
 */
export function isRetryableStatus(status: number): boolean {
  return (
    status === HTTP_REQUEST_TIMEOUT ||
    status === HTTP_CONFLICT ||
    status === HTTP_TOO_MANY_REQUESTS ||
    status >= HTTP_SERVER_ERROR
  );
}

export class SndrEmailSender implements EmailSender {
  readonly name = "sndr";

  constructor(private readonly config: SndrConfig) {}

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    let response: Response;
    try {
      response = await fetch(new URL("/v1/send", this.config.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
          "idempotency-key": email.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
        // The API never redirects; following one could send the key elsewhere.
        redirect: "error",
      });
    } catch {
      // Network failure or timeout. The cause is dropped: it can echo the URL and headers.
      throw new EmailSendFailed("send", null, null, true);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = errorResponse.safeParse(payload);
      throw new EmailSendFailed(
        "send",
        response.status,
        error.success ? error.data.error.code : null,
        isRetryableStatus(response.status),
      );
    }
    const parsed = sendResponse.safeParse(payload);
    // Accepted by status but unreadable: the message may be queued. Retrying with the
    // same Idempotency-Key returns the first response, so it is safe and cannot double-send.
    if (!parsed.success)
      throw new EmailSendFailed("send", response.status, "UNEXPECTED_RESPONSE", true);
    return { messageId: parsed.data.id };
  }
}
