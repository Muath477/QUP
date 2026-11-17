/**
 * Where an email is in its life. Pure, so the rules are testable without a
 * database. Mirrors the CHECK constraint on `email_deliveries.status`.
 *
 *   QUEUED ──► SENT ──► DELIVERED
 *      │         ├────► BOUNCED
 *      └─► FAILED◄─────┘
 *
 * QUEUED: not accepted by the provider yet. SENT: accepted, outcome unknown.
 * DELIVERED / BOUNCED / FAILED: the provider's final word (FAILED also: we gave up).
 */

export type EmailDeliveryStatus = "QUEUED" | "SENT" | "DELIVERED" | "BOUNCED" | "FAILED";

export type ProviderReportedStatus = Extract<
  EmailDeliveryStatus,
  "DELIVERED" | "BOUNCED" | "FAILED"
>;

const FINAL: readonly EmailDeliveryStatus[] = ["DELIVERED", "BOUNCED", "FAILED"];

export function isFinalStatus(status: EmailDeliveryStatus): boolean {
  return FINAL.includes(status);
}

/**
 * Whether a provider event may move a delivery from `from` to `to`. Events
 * arrive late, twice, and out of order: a final status is never overwritten,
 * so a replay or a stale event changes nothing.
 */
export function canApplyProviderStatus(
  from: EmailDeliveryStatus,
  to: ProviderReportedStatus,
): boolean {
  return !isFinalStatus(from) && from !== to;
}

/** The statuses from which a provider event may still move a delivery. */
export const OPEN_STATUSES: readonly EmailDeliveryStatus[] = ["QUEUED", "SENT"];

/** SNDR's event names (docs: Webhooks) → our status. Events that are not about delivery map to null. */
export function statusFromSndrEvent(eventType: string): ProviderReportedStatus | null {
  switch (eventType) {
    case "email.delivered":
      return "DELIVERED";
    case "email.bounced":
      return "BOUNCED";
    case "email.failed":
      return "FAILED";
    default:
      return null;
  }
}
