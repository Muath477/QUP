import { Inject, Injectable } from "@nestjs/common";
import { type Database, tables } from "@qup/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import { DATABASE } from "../../../infrastructure/database/database.module.js";
import { OPEN_STATUSES, type ProviderReportedStatus } from "../domain/delivery-status.js";
import type { EmailDelivery, EmailDeliveryStore } from "../domain/ports.js";

const { emailDeliveries } = tables;

/** Provider error text kept on the row; longer messages are cut. */
const MAX_ERROR_CHARS = 300;

const deliveryColumns = {
  id: emailDeliveries.id,
  status: emailDeliveries.status,
  providerMessageId: emailDeliveries.providerMessageId,
  attempts: emailDeliveries.attempts,
};

@Injectable()
export class DrizzleEmailDeliveryStore implements EmailDeliveryStore {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async begin(input: {
    userId: string | null;
    kind: string;
    toAddress: string;
    provider: string;
    idempotencyKey: string;
  }): Promise<EmailDelivery> {
    // Two workers (or a retry) racing on one logical email both end up with the one row.
    await this.db
      .insert(emailDeliveries)
      .values(input)
      .onConflictDoNothing({ target: emailDeliveries.idempotencyKey });
    const [row] = await this.db
      .select(deliveryColumns)
      .from(emailDeliveries)
      .where(eq(emailDeliveries.idempotencyKey, input.idempotencyKey));
    if (!row) throw new Error("Email delivery vanished right after being created.");
    return row;
  }

  async markSent(id: string, messageId: string, at: Date): Promise<void> {
    await this.db
      .update(emailDeliveries)
      .set({
        status: "SENT",
        providerMessageId: messageId,
        sentAt: at,
        attempts: sql`${emailDeliveries.attempts} + 1`,
        lastError: null,
      })
      .where(and(eq(emailDeliveries.id, id), eq(emailDeliveries.status, "QUEUED")));
  }

  async markAttemptFailed(id: string, error: string): Promise<void> {
    await this.db
      .update(emailDeliveries)
      .set({
        attempts: sql`${emailDeliveries.attempts} + 1`,
        lastError: error.slice(0, MAX_ERROR_CHARS),
      })
      .where(and(eq(emailDeliveries.id, id), eq(emailDeliveries.status, "QUEUED")));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db
      .update(emailDeliveries)
      .set({
        status: "FAILED",
        attempts: sql`${emailDeliveries.attempts} + 1`,
        lastError: error.slice(0, MAX_ERROR_CHARS),
      })
      .where(and(eq(emailDeliveries.id, id), eq(emailDeliveries.status, "QUEUED")));
  }

  async applyProviderStatus(
    provider: string,
    messageId: string,
    status: ProviderReportedStatus,
    detail: string | null,
  ): Promise<boolean> {
    const where = and(
      eq(emailDeliveries.provider, provider),
      eq(emailDeliveries.providerMessageId, messageId),
    );
    const moved = await this.db
      .update(emailDeliveries)
      .set({ status, ...(detail ? { lastError: detail.slice(0, MAX_ERROR_CHARS) } : {}) })
      // A final status is never overwritten: replays and stale events change nothing.
      .where(and(where, inArray(emailDeliveries.status, [...OPEN_STATUSES])))
      .returning({ id: emailDeliveries.id });
    if (moved.length > 0) return true;
    const [known] = await this.db
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(where);
    return known !== undefined;
  }
}
