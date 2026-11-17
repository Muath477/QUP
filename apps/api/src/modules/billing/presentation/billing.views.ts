import type { AccessStatus } from "../application/entitlements.service.js";
import type { PlanOffer } from "../application/plans.service.js";
import type { Entitlement, Payment, PaymentRecord, Plan, RevenueSummary } from "../domain/ports.js";
import { refundableUntil } from "../domain/refund-policy.js";

const iso = (date: Date | null) => date?.toISOString() ?? null;

const price = (amountMinor: number, currency: string) => ({ amountMinor, currency });

/** What a buyer sees of a plan; also the base of the admin view. */
function planContentView(plan: Plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    features: plan.features,
    highlighted: plan.highlighted,
    price: price(plan.priceMinor, plan.currency),
    compareAtPrice:
      plan.compareAtPriceMinor === null ? null : price(plan.compareAtPriceMinor, plan.currency),
    durationDays: plan.durationDays,
  };
}

/** A plan as a student sees it for sale, with the exams it unlocks. */
export function toPlanOfferView({ plan, exams }: PlanOffer) {
  return {
    ...planContentView(plan),
    exams: exams.map((exam) => ({ id: exam.id, nameAr: exam.nameAr })),
    isBundle: exams.length > 1,
  };
}

export function toAdminPlanView(plan: Plan) {
  return {
    ...planContentView(plan),
    examIds: plan.examIds,
    code: plan.code,
    sortOrder: plan.sortOrder,
    status: plan.status,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function toAccessView(examId: string, access: AccessStatus) {
  return { examId, hasAccess: access.hasAccess, activeUntil: iso(access.activeUntil) };
}

export function toEntitlementView(entitlement: Entitlement) {
  return {
    id: entitlement.id,
    examId: entitlement.examId,
    source: entitlement.source,
    status: entitlement.status,
    startsAt: entitlement.startsAt.toISOString(),
    endsAt: iso(entitlement.endsAt),
  };
}

export function toAdminEntitlementView(entitlement: Entitlement) {
  return {
    ...toEntitlementView(entitlement),
    studentId: entitlement.studentId,
    planId: entitlement.planId,
  };
}

/**
 * A payment as its owner sees it. The checkout link is only offered while the
 * payment can still be paid; provider references stay server-side.
 */
export function toPaymentView(payment: Payment) {
  const payable = payment.status === "PENDING";
  return {
    id: payment.id,
    planId: payment.planId,
    planName: payment.terms?.planName ?? null,
    examIds: payment.terms?.examIds ?? [],
    status: payment.status,
    amount: price(payment.amountMinor, payment.currency),
    checkoutUrl: payable ? payment.checkoutUrl : null,
    checkoutExpiresAt: payable ? iso(payment.checkoutExpiresAt) : null,
    paidAt: iso(payment.paidAt),
    refundableUntil: payment.status === "SUCCEEDED" ? iso(refundableUntil(payment.paidAt)) : null,
    createdAt: payment.createdAt.toISOString(),
  };
}

/** The admin ledger row: the owner's view plus who paid and Stream's references. */
export function toAdminPaymentView(payment: PaymentRecord) {
  return {
    ...toPaymentView(payment),
    // The admin never needs to send a student to an old checkout.
    checkoutUrl: null,
    planName: payment.terms?.planName ?? payment.planName,
    student: payment.student,
    provider: payment.provider,
    providerReference: payment.providerReference,
    providerPaymentId: payment.providerPaymentId,
  };
}

/** `succeeded` is money kept: a refunded payment counts under `refunded` only. */
export function toRevenueSummaryView(summary: RevenueSummary) {
  return {
    since: summary.since.toISOString(),
    succeeded: {
      count: summary.succeeded.count,
      amount: price(summary.succeeded.amountMinor, summary.currency),
    },
    refunded: {
      count: summary.refunded.count,
      amount: price(summary.refunded.amountMinor, summary.currency),
    },
    abandoned: summary.abandoned,
  };
}
