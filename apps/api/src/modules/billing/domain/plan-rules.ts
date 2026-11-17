/**
 * What a plan is allowed to become, and what a purchase of it freezes. Pure,
 * so every rule is testable without a database.
 *
 * Product Owner decision (2026-11-16, OPEN_QUESTIONS.md #3/#5a): an admin can
 * change the price, duration and wording of a plan that is on sale. That is
 * safe because each payment keeps the amount it was opened for and the terms
 * it bought (`PurchasedTerms`): a change reaches the next buyer only. What a
 * plan *is* — which exams it unlocks — is fixed once it is offered; a
 * different product is a different plan.
 */

import type { PlanStatus } from "./plan-lifecycle.js";

export const PLAN_LIMITS = {
  maxNameLength: 200,
  maxDescriptionLength: 300,
  maxFeatures: 12,
  maxFeatureLength: 160,
  /** A bundle covers a handful of exams; more is a data-entry mistake. */
  maxExams: 10,
} as const;

/** The fields an admin edits. Code and currency never change: payments refer to them. */
export interface PlanContent {
  name: string;
  description: string | null;
  features: readonly string[];
  highlighted: boolean;
  sortOrder: number;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  durationDays: number | null;
  examIds: readonly string[];
}

export type PlanContentField = keyof PlanContent;

const EDITABLE: Record<PlanStatus, readonly PlanContentField[]> = {
  DRAFT: [
    "name",
    "description",
    "features",
    "highlighted",
    "sortOrder",
    "priceMinor",
    "compareAtPriceMinor",
    "durationDays",
    "examIds",
  ],
  ACTIVE: [
    "name",
    "description",
    "features",
    "highlighted",
    "sortOrder",
    "priceMinor",
    "compareAtPriceMinor",
    "durationDays",
  ],
  // A retired plan is history: it explains the payments it took.
  RETIRED: [],
};

/** Fields of `changes` the plan's status does not allow to change. */
export function lockedFields(
  status: PlanStatus,
  changes: Partial<PlanContent>,
): PlanContentField[] {
  const editable = EDITABLE[status];
  return (Object.keys(changes) as PlanContentField[]).filter((field) => !editable.includes(field));
}

export type PlanContentProblem = "COMPARE_AT_NOT_ABOVE_PRICE" | "NO_EXAMS" | "DUPLICATE_EXAMS";

/** Problems with a plan's content as a whole, after a change is applied. */
export function contentProblems(content: PlanContent): PlanContentProblem[] {
  const problems: PlanContentProblem[] = [];
  if (content.compareAtPriceMinor !== null && content.compareAtPriceMinor <= content.priceMinor) {
    problems.push("COMPARE_AT_NOT_ABOVE_PRICE");
  }
  if (content.examIds.length === 0) problems.push("NO_EXAMS");
  if (new Set(content.examIds).size !== content.examIds.length) problems.push("DUPLICATE_EXAMS");
  return problems;
}

/** Scalar, so it fits the audit log's metadata. Lists are joined, in order. */
type AuditValue = string | number | boolean | null;

function auditValue(value: PlanContent[PlanContentField]): AuditValue {
  if (Array.isArray(value)) return value.join(" | ");
  return value as AuditValue;
}

function sameValue(a: PlanContent[PlanContentField], b: PlanContent[PlanContentField]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

/**
 * The fields that really change, as `<field>.before` / `<field>.after` pairs
 * for the audit entry. Empty when the change is a no-op.
 */
export function contentChanges(
  current: PlanContent,
  changes: Partial<PlanContent>,
): Record<string, AuditValue> {
  const diff: Record<string, AuditValue> = {};
  for (const field of Object.keys(changes) as PlanContentField[]) {
    const next = changes[field];
    if (next === undefined || sameValue(current[field], next)) continue;
    diff[`${field}.before`] = auditValue(current[field]);
    diff[`${field}.after`] = auditValue(next);
  }
  return diff;
}

/** What a payment buys, frozen when the checkout opens. */
export interface PurchasedTerms {
  planName: string;
  durationDays: number | null;
  examIds: string[];
}

export function purchasedTerms(plan: {
  name: string;
  durationDays: number | null;
  examIds: readonly string[];
}): PurchasedTerms {
  // Sorted: grants then take their per-exam locks in one global order (no deadlock).
  return {
    planName: plan.name,
    durationDays: plan.durationDays,
    examIds: [...plan.examIds].sort(),
  };
}

/**
 * Whether an open checkout still sells what the plan sells now. One opened
 * before a price or duration change must not be handed out again: the student
 * would pay what the page no longer says.
 */
export function checkoutStillMatches(
  open: { amountMinor: number; currency: string; terms: PurchasedTerms | null },
  plan: {
    priceMinor: number;
    currency: string;
    durationDays: number | null;
    examIds: readonly string[];
  },
): boolean {
  if (open.amountMinor !== plan.priceMinor || open.currency !== plan.currency) return false;
  if (open.terms === null) return true;
  const now = purchasedTerms({ name: open.terms.planName, ...plan });
  return (
    open.terms.durationDays === now.durationDays &&
    open.terms.examIds.length === now.examIds.length &&
    open.terms.examIds.every((id, index) => id === now.examIds[index])
  );
}

/**
 * Buying is refused only when it would add nothing: the student already has
 * access to every exam the plan covers. A bundle bought on top of one exam's
 * access is allowed; that exam's share queues behind the current access.
 */
export function wouldAddAccess(coveredExamAccess: readonly boolean[]): boolean {
  return coveredExamAccess.some((hasAccess) => !hasAccess);
}
