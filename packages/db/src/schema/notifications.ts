import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, primaryKeyId, updatedAt } from "./_shared.js";
import { users } from "./identity.js";

/**
 * One-time codes and email delivery (0019).
 *
 * A code is never stored: only an HMAC of it, keyed by a server secret and
 * bound to its purpose and address, so a database leak cannot be replayed and
 * a code for one purpose cannot be spent on another. Both tables hold contact
 * details, which is why they are separate from the outbox, whose payloads
 * carry ids only (outbox.ts).
 */

export const ONE_TIME_CODE_PURPOSES = ["EMAIL_VERIFICATION", "PASSWORD_RESET"] as const;
export type OneTimeCodePurpose = (typeof ONE_TIME_CODE_PURPOSES)[number];

export const oneTimeCodes = pgTable(
  "one_time_codes",
  {
    id: primaryKeyId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<OneTimeCodePurpose>().notNull(),
    /** The address the code was sent to, as it was when sent. */
    email: text("email").notNull(),
    /** HMAC-SHA256 hex of the code. Never the code. */
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Wrong guesses so far; the code is burned when they reach the limit. */
    failedAttempts: integer("failed_attempts").notNull().default(0),
    /** Spent, burned or replaced by a newer code. */
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    // At most one live code per user and purpose: asking again replaces it.
    uniqueIndex("one_time_codes_one_live")
      .on(table.userId, table.purpose)
      .where(sql`consumed_at IS NULL`),
    // Resend cooldown and hourly limit read recent rows of a user and purpose.
    index("one_time_codes_user_purpose_created_idx").on(
      table.userId,
      table.purpose,
      table.createdAt,
    ),
    check(
      "one_time_codes_purpose_known",
      sql`${table.purpose} IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET')`,
    ),
    check("one_time_codes_attempts_non_negative", sql`${table.failedAttempts} >= 0`),
  ],
);

export const EMAIL_DELIVERY_STATUSES = [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "BOUNCED",
  "FAILED",
] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

/**
 * What was sent to whom, and what became of it: the log support reads when a
 * student says "the email never came". No subject, body or code is kept.
 */
export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: primaryKeyId(),
    /** Null for mail to someone who has no account. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    toAddress: text("to_address").notNull(),
    status: text("status").$type<EmailDeliveryStatus>().notNull().default("QUEUED"),
    provider: text("provider").notNull(),
    /** The provider's id for the message, once it accepted it. */
    providerMessageId: text("provider_message_id"),
    /** Sent to the provider as Idempotency-Key: one logical email is sent once. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Send attempts made, including the successful one. */
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("email_deliveries_idempotency_key_unique").on(table.idempotencyKey),
    index("email_deliveries_provider_message_idx")
      .on(table.provider, table.providerMessageId)
      .where(sql`provider_message_id IS NOT NULL`),
    index("email_deliveries_user_created_idx").on(table.userId, table.createdAt),
    index("email_deliveries_status_created_idx").on(table.status, table.createdAt),
    check(
      "email_deliveries_status_known",
      sql`${table.status} IN ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED')`,
    ),
    check("email_deliveries_attempts_non_negative", sql`${table.attempts} >= 0`),
  ],
);

export const oneTimeCodesRelations = relations(oneTimeCodes, ({ one }) => ({
  user: one(users, { fields: [oneTimeCodes.userId], references: [users.id] }),
}));

export const emailDeliveriesRelations = relations(emailDeliveries, ({ one }) => ({
  user: one(users, { fields: [emailDeliveries.userId], references: [users.id] }),
}));
