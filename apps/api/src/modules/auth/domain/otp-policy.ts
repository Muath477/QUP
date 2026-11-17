import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One-time codes (OPEN_QUESTIONS.md #6a, #6c): a six-digit code mailed to an
 * address proves its owner can read it — to verify the address, or to set a
 * new password. Pure rules, no I/O, so each is testable on its own.
 *
 * What makes a six-digit code safe is not its size but the limits around it:
 * it lives ten minutes, five wrong guesses burn it, it can be requested once a
 * minute and five times an hour, only its HMAC is stored, and it is bound to
 * its purpose and address so it cannot be spent on anything else.
 */

export type OneTimeCodePurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export const OTP_POLICY = Object.freeze({
  codeLength: 6,
  validForMinutes: 10,
  /** Wrong guesses a code survives. The fifth burns it. */
  maxFailedAttempts: 5,
  /** Minimum gap between two requests for the same purpose. */
  resendCooldownSeconds: 60,
  /** Codes a user may be sent for one purpose in any hour. */
  maxPerHour: 5,
});

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

export function codeExpiry(now: Date): Date {
  return new Date(now.getTime() + OTP_POLICY.validForMinutes * MS_PER_MINUTE);
}

/**
 * What a person typed, as a code: digits only. Arabic-Indic digits and spaces
 * (a code copied as "123 456") are accepted; anything else makes it malformed.
 */
export function normalizeCode(input: string): string | null {
  const digits = input
    .replace(/[\s‎‏-]/g, "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO));
  return new RegExp(`^\\d{${OTP_POLICY.codeLength}}$`).test(digits) ? digits : null;
}

/**
 * HMAC-SHA256 of the code, keyed by a server secret and bound to the purpose
 * and address: the same digits for another purpose or another address hash
 * differently, and a leaked table cannot be brute-forced without the secret.
 */
export function hashCode(
  secret: string,
  purpose: OneTimeCodePurpose,
  email: string,
  code: string,
): string {
  return createHmac("sha256", secret).update(`${purpose}\n${email}\n${code}`).digest("hex");
}

export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export type IssueDecision =
  | { kind: "ALLOWED" }
  | { kind: "TOO_SOON"; retryAfterSeconds: number }
  | { kind: "HOURLY_LIMIT" };

/**
 * May another code be issued? `previousIssuedAt`: when the user's latest code
 * for this purpose was issued; `issuedInLastHour`: how many were.
 */
export function decideIssue(input: {
  now: Date;
  previousIssuedAt: Date | null;
  issuedInLastHour: number;
}): IssueDecision {
  if (input.issuedInLastHour >= OTP_POLICY.maxPerHour) return { kind: "HOURLY_LIMIT" };
  if (input.previousIssuedAt) {
    const elapsedMs = input.now.getTime() - input.previousIssuedAt.getTime();
    const cooldownMs = OTP_POLICY.resendCooldownSeconds * MS_PER_SECOND;
    if (elapsedMs < cooldownMs) {
      return {
        kind: "TOO_SOON",
        retryAfterSeconds: Math.ceil((cooldownMs - elapsedMs) / MS_PER_SECOND),
      };
    }
  }
  return { kind: "ALLOWED" };
}

export const ISSUE_WINDOW_MS = MS_PER_HOUR;

export type GuessDecision = "ACCEPT" | "REJECT" | "REJECT_AND_BURN";

/**
 * What to do with a guess against a live code. A code past its expiry, or one
 * guessed wrong `maxFailedAttempts` times, is no longer a code.
 */
export function decideGuess(input: {
  now: Date;
  expiresAt: Date;
  failedAttempts: number;
  correct: boolean;
}): GuessDecision {
  if (input.now.getTime() >= input.expiresAt.getTime()) return "REJECT_AND_BURN";
  if (input.correct) return "ACCEPT";
  return input.failedAttempts + 1 >= OTP_POLICY.maxFailedAttempts ? "REJECT_AND_BURN" : "REJECT";
}
