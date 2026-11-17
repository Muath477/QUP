/**
 * OPEN_QUESTIONS.md #5 (Product Owner, 2026-11-16): a full refund may be
 * asked for within 48 hours of the subscription starting, through the contact
 * channels. The refund itself is made at Stream; its webhook then revokes the
 * access (payments.service.ts). This only says until when a request is in time,
 * so the student and the admin see the same date.
 */

export const REFUND_WINDOW_HOURS = 48;

const MS_PER_HOUR = 3_600_000;

/** Null when nothing was paid. */
export function refundableUntil(paidAt: Date | null): Date | null {
  return paidAt === null ? null : new Date(paidAt.getTime() + REFUND_WINDOW_HOURS * MS_PER_HOUR);
}
