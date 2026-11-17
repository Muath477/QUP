/**
 * Public read contract of Billing, for other modules (AGENTS.md §5).
 * Owned here, the provider: assessments → billing, never back.
 *
 * DOMAIN_MODEL.md §3: "entitlement checked server-side" — this is that check.
 */
export interface ExamAccess {
  /** Whether the student has an entitlement in force for the exam right now. */
  hasExamAccess(studentId: string, examId: string): Promise<boolean>;
}

export const EXAM_ACCESS = Symbol("EXAM_ACCESS");

/** What a payment bought and what became of it — enough to write the student a receipt. */
export interface PaymentReceipt {
  studentId: string;
  planName: string;
  amountMinor: number;
  currency: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED" | "CANCELLED";
  paidAt: Date | null;
  /** Until when a full refund may be asked for (refund-policy.ts); null when nothing was paid. */
  refundableUntil: Date | null;
}

export interface PaymentReceipts {
  /** Null when no such payment exists. */
  receiptFor(paymentId: string): Promise<PaymentReceipt | null>;
}

export const PAYMENT_RECEIPTS = Symbol("PAYMENT_RECEIPTS");
