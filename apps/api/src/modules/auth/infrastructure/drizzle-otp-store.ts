import { Inject, Injectable } from "@nestjs/common";
import { type Database, tables } from "@qup/db";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { AuditAction, writeAudit } from "../../../infrastructure/audit/audit-log.js";
import { DATABASE } from "../../../infrastructure/database/database.module.js";
import type { DbTransaction } from "../../../infrastructure/database/executor.js";
import { OutboxEventType, writeOutbox } from "../../../infrastructure/outbox/outbox.js";
import {
  codeExpiry,
  decideGuess,
  decideIssue,
  ISSUE_WINDOW_MS,
  type OneTimeCodePurpose,
} from "../domain/otp-policy.js";
import type { ConsumeCodeResult, IssueCodeResult, OtpStore, StoredCode } from "../domain/ports.js";

const { oneTimeCodes, users, authSessions } = tables;

type Consumed = { ok: true; email: string } | { ok: false };

@Injectable()
export class DrizzleOtpStore implements OtpStore {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  issue(input: {
    userId: string;
    purpose: OneTimeCodePurpose;
    email: string;
    codeHash: string;
    now: Date;
  }): Promise<IssueCodeResult> {
    return this.db.transaction(async (tx) => {
      // Two requests landing together queue here instead of both passing the cooldown.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`otp:${input.userId}:${input.purpose}`}, 0))`,
      );
      const scope = and(
        eq(oneTimeCodes.userId, input.userId),
        eq(oneTimeCodes.purpose, input.purpose),
      );
      const [latest] = await tx
        .select({ createdAt: oneTimeCodes.createdAt })
        .from(oneTimeCodes)
        .where(scope)
        .orderBy(desc(oneTimeCodes.createdAt))
        .limit(1);
      const [recent] = await tx
        .select({ n: count() })
        .from(oneTimeCodes)
        .where(
          and(scope, gt(oneTimeCodes.createdAt, new Date(input.now.getTime() - ISSUE_WINDOW_MS))),
        );

      const decision = decideIssue({
        now: input.now,
        previousIssuedAt: latest?.createdAt ?? null,
        issuedInLastHour: recent?.n ?? 0,
      });
      if (decision.kind !== "ALLOWED") return decision;

      // A new code replaces the old one: only the latest is ever live.
      await tx
        .update(oneTimeCodes)
        .set({ consumedAt: input.now })
        .where(and(scope, isNull(oneTimeCodes.consumedAt)));
      const [created] = await tx
        .insert(oneTimeCodes)
        .values({
          userId: input.userId,
          purpose: input.purpose,
          email: input.email,
          codeHash: input.codeHash,
          expiresAt: codeExpiry(input.now),
          createdAt: input.now,
        })
        .returning({ id: oneTimeCodes.id });
      if (!created) throw new Error("One-time code insert returned no row.");
      return { kind: "ISSUED", codeId: created.id };
    });
  }

  async discard(codeId: string): Promise<void> {
    await this.db.delete(oneTimeCodes).where(eq(oneTimeCodes.id, codeId));
  }

  confirmEmail(input: {
    userId: string;
    now: Date;
    matches: (code: StoredCode) => boolean;
  }): Promise<ConsumeCodeResult> {
    return this.db.transaction(async (tx) => {
      const consumed = await this.consume(tx, input.userId, "EMAIL_VERIFICATION", input);
      if (!consumed.ok) return "INVALID";

      // The address may have changed since the code was sent: it must still be that one.
      const verified = await tx
        .update(users)
        .set({ emailVerifiedAt: input.now })
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.email, consumed.email),
            isNull(users.emailVerifiedAt),
          ),
        )
        .returning({ id: users.id });
      if (verified.length > 0) {
        await writeAudit(
          tx,
          { userId: input.userId, requestId: null },
          { action: AuditAction.EmailVerified, resourceType: "user", resourceId: input.userId },
        );
      }
      return "DONE";
    });
  }

  resetPassword(input: {
    userId: string;
    now: Date;
    matches: (code: StoredCode) => boolean;
    passwordHash: string;
  }): Promise<ConsumeCodeResult> {
    return this.db.transaction(async (tx) => {
      const consumed = await this.consume(tx, input.userId, "PASSWORD_RESET", input);
      if (!consumed.ok) return "INVALID";

      const [user] = await tx
        .select({ status: users.status, email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update");
      // A suspended account does not come back to life through a mailbox.
      if (user?.status !== "ACTIVE") return "INVALID";

      await tx
        .update(users)
        .set({
          passwordHash: input.passwordHash,
          updatedAt: input.now,
          // Reading the mail proved the mailbox — if it is still the account's address.
          ...(user.email === consumed.email && {
            emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${input.now.toISOString()}::timestamptz)`,
          }),
        })
        .where(eq(users.id, input.userId));
      // Whoever had the old password, or a stolen session, is signed out everywhere.
      await tx
        .update(authSessions)
        .set({ revokedAt: input.now })
        .where(and(eq(authSessions.userId, input.userId), isNull(authSessions.revokedAt)));
      await writeAudit(
        tx,
        { userId: input.userId, requestId: null },
        { action: AuditAction.PasswordReset, resourceType: "user", resourceId: input.userId },
      );
      await writeOutbox(tx, {
        type: OutboxEventType.EmailRequested,
        aggregateType: "user",
        aggregateId: input.userId,
        payload: { kind: "PASSWORD_CHANGED", userId: input.userId },
      });
      return "DONE";
    });
  }

  /**
   * Checks a guess against the user's live code for a purpose, under a row
   * lock so two guesses cannot both count as "the first". The attempt counter
   * and the burn commit with the caller's transaction even when the guess is
   * wrong, so a failed guess cannot be rolled back and retried for free.
   */
  private async consume(
    tx: DbTransaction,
    userId: string,
    purpose: OneTimeCodePurpose,
    input: { now: Date; matches: (code: StoredCode) => boolean },
  ): Promise<Consumed> {
    const [code] = await tx
      .select()
      .from(oneTimeCodes)
      .where(
        and(
          eq(oneTimeCodes.userId, userId),
          eq(oneTimeCodes.purpose, purpose),
          isNull(oneTimeCodes.consumedAt),
        ),
      )
      .for("update");
    if (!code) return { ok: false };

    const decision = decideGuess({
      now: input.now,
      expiresAt: code.expiresAt,
      failedAttempts: code.failedAttempts,
      correct: input.matches({ codeHash: code.codeHash, email: code.email }),
    });
    if (decision === "ACCEPT") {
      await tx
        .update(oneTimeCodes)
        .set({ consumedAt: input.now })
        .where(eq(oneTimeCodes.id, code.id));
      return { ok: true, email: code.email };
    }
    await tx
      .update(oneTimeCodes)
      .set({
        failedAttempts: sql`${oneTimeCodes.failedAttempts} + 1`,
        ...(decision === "REJECT_AND_BURN" && { consumedAt: input.now }),
      })
      .where(eq(oneTimeCodes.id, code.id));
    return { ok: false };
  }
}
