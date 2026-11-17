import { randomInt } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "../../../config/app-config.js";
import {
  EmailNotConfigured,
  EmailUnavailable,
  TRANSACTIONAL_EMAIL,
  type TransactionalEmail,
} from "../../email/email.contract.js";
import {
  CodeRequestedTooOften,
  EmailAlreadyVerified,
  EmailRequired,
  InvalidOrExpiredCode,
  NotAuthenticated,
} from "../domain/auth.errors.js";
import {
  hashCode,
  hashesEqual,
  normalizeCode,
  type OneTimeCodePurpose,
  OTP_POLICY,
} from "../domain/otp-policy.js";
import {
  AUTH_STORE,
  type AuthStore,
  CLOCK,
  type Clock,
  OTP_STORE,
  type OtpStore,
  PASSWORD_HASHER,
  type PasswordHasher,
  type StoredCode,
} from "../domain/ports.js";
import type { Principal } from "../domain/principal.js";

const CODE_SPACE = 10 ** OTP_POLICY.codeLength;
/** What "an hour" means to a person who hit the hourly limit: they are told to wait about this long. */
const HOURLY_LIMIT_RETRY_SECONDS = 3_600;

export interface CodeRequested {
  validForMinutes: number;
  resendAfterSeconds: number;
}

/**
 * Proving a mailbox (OPEN_QUESTIONS.md #6a): verify an address, or set a new
 * password after forgetting it. The codes and their limits are otp-policy.ts;
 * storing, checking and burning them is the OtpStore, atomically with the
 * effect (the address verified, the password changed).
 *
 * Asking for a reset never reveals whether an account exists: the answer is
 * the same for a registered address, an unknown one, a throttled one and one
 * whose mail could not be sent. Only the sign-up form already tells a stranger
 * that an address is taken (IDENTIFIER_TAKEN), so this adds nothing to learn.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    @Inject(OTP_STORE) private readonly otp: OtpStore,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TRANSACTIONAL_EMAIL) private readonly email: TransactionalEmail,
    @InjectPinoLogger(OtpService.name) private readonly logger: PinoLogger,
  ) {}

  /** Whether codes can be sent at all: a provider and the key that hashes them. */
  get enabled(): boolean {
    return this.email.enabled && this.config.email.otpSecret !== null;
  }

  async requestEmailVerification(principal: Principal): Promise<CodeRequested> {
    const secret = this.requireSecret();
    const user = await this.store.findProfile(principal.userId);
    if (!user) throw new NotAuthenticated();
    if (!user.email) throw new EmailRequired();
    if (user.emailVerifiedAt) throw new EmailAlreadyVerified();

    const issued = await this.issueAndSend(secret, "EMAIL_VERIFICATION", user.id, user.email);
    if (issued.kind === "TOO_SOON") throw new CodeRequestedTooOften(issued.retryAfterSeconds);
    if (issued.kind === "HOURLY_LIMIT") throw new CodeRequestedTooOften(HOURLY_LIMIT_RETRY_SECONDS);
    // NOT_SENT cannot happen here: a failed send for this purpose is rethrown above.
    return {
      validForMinutes: OTP_POLICY.validForMinutes,
      resendAfterSeconds: OTP_POLICY.resendCooldownSeconds,
    };
  }

  async confirmEmail(principal: Principal, rawCode: string): Promise<void> {
    const secret = this.requireSecret();
    const code = normalizeCode(rawCode);
    if (!code) throw new InvalidOrExpiredCode();
    const user = await this.store.findProfile(principal.userId);
    if (!user) throw new NotAuthenticated();
    if (!user.email) throw new EmailRequired();
    if (user.emailVerifiedAt) throw new EmailAlreadyVerified();

    const result = await this.otp.confirmEmail({
      userId: user.id,
      now: this.clock.now(),
      matches: matcher(secret, "EMAIL_VERIFICATION", code),
    });
    if (result === "INVALID") throw new InvalidOrExpiredCode();
    this.logger.info({ userId: user.id }, "Email address verified");
  }

  /** Always resolves the same way for an address that can be mailed, whatever it is. */
  async requestPasswordReset(email: string): Promise<CodeRequested> {
    const secret = this.requireSecret();
    const answer: CodeRequested = {
      validForMinutes: OTP_POLICY.validForMinutes,
      resendAfterSeconds: OTP_POLICY.resendCooldownSeconds,
    };
    const account = await this.store.findCredentialsByEmail(email);
    // A phone-only, unknown or suspended account gets nothing — and the same answer.
    if (account?.status !== "ACTIVE") return answer;

    const issued = await this.issueAndSend(secret, "PASSWORD_RESET", account.userId, email);
    if (issued.kind !== "SENT") {
      this.logger.info({ userId: account.userId, outcome: issued.kind }, "Password reset not sent");
    }
    return answer;
  }

  async resetPassword(command: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<void> {
    const secret = this.requireSecret();
    const code = normalizeCode(command.code);
    if (!code) throw new InvalidOrExpiredCode();
    const account = await this.store.findCredentialsByEmail(command.email);
    if (account?.status !== "ACTIVE") throw new InvalidOrExpiredCode();

    // Argon2 is slow on purpose: hash before the transaction, never inside it.
    const passwordHash = await this.hasher.hash(command.newPassword);
    const result = await this.otp.resetPassword({
      userId: account.userId,
      now: this.clock.now(),
      matches: matcher(secret, "PASSWORD_RESET", code),
      passwordHash,
    });
    if (result === "INVALID") throw new InvalidOrExpiredCode();
    this.logger.info({ userId: account.userId }, "Password reset with a mailed code");
  }

  /**
   * Issues a fresh code and mails it. A code that could not be mailed is
   * discarded, so a provider outage does not burn the person's resend cooldown.
   */
  private async issueAndSend(
    secret: string,
    purpose: OneTimeCodePurpose,
    userId: string,
    email: string,
  ): Promise<
    | { kind: "SENT" }
    | { kind: "NOT_SENT" }
    | { kind: "TOO_SOON"; retryAfterSeconds: number }
    | { kind: "HOURLY_LIMIT" }
  > {
    const code = randomInt(0, CODE_SPACE).toString().padStart(OTP_POLICY.codeLength, "0");
    const issued = await this.otp.issue({
      userId,
      purpose,
      email,
      codeHash: hashCode(secret, purpose, email, code),
      now: this.clock.now(),
    });
    if (issued.kind !== "ISSUED") return issued;
    try {
      await this.email.sendCode({
        userId,
        to: email,
        purpose,
        code,
        validForMinutes: OTP_POLICY.validForMinutes,
        codeId: issued.codeId,
      });
    } catch (error) {
      await this.otp.discard(issued.codeId);
      // Verifying your own address deserves to hear the mail failed; a reset must not tell.
      if (purpose === "EMAIL_VERIFICATION") throw error;
      if (!(error instanceof EmailUnavailable) && !(error instanceof EmailNotConfigured))
        throw error;
      this.logger.error({ userId, purpose }, "A code could not be mailed");
      return { kind: "NOT_SENT" };
    }
    return { kind: "SENT" };
  }

  private requireSecret(): string {
    const secret = this.config.email.otpSecret;
    if (!this.email.enabled || secret === null) throw new EmailNotConfigured();
    return secret;
  }
}

/** Compares a guess with a stored code: same purpose, same address the code was mailed to. */
function matcher(
  secret: string,
  purpose: OneTimeCodePurpose,
  code: string,
): (stored: StoredCode) => boolean {
  return (stored) => hashesEqual(stored.codeHash, hashCode(secret, purpose, stored.email, code));
}
