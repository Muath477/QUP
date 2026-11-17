"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { listMyPayments, type Payment, type PaymentStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { formatPrice } from "@/lib/messages";
import { useCurrentUser } from "@/lib/session";
import { ErrorNotice, Loading } from "./status";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "بانتظار الدفع",
  SUCCEEDED: "مدفوعة",
  FAILED: "لم تكتمل",
  REFUNDED: "مسترجعة",
  CANCELLED: "ملغاة",
};

/** The student's own payments, as the server reports them. */
export function PaymentHistory() {
  const { data: user } = useCurrentUser();
  const payments = useQuery({
    queryKey: ["my-payments", user?.id],
    queryFn: listMyPayments,
    enabled: !!user,
  });

  if (payments.isPending) return <Loading label="جارٍ تحميل سجل المدفوعات…" />;
  if (payments.isError) return <ErrorNotice error={payments.error} />;
  if (payments.data.items.length === 0) {
    return <p className="small muted">لا توجد مدفوعات بعد.</p>;
  }
  return (
    <ul className="list payment-list">
      {payments.data.items.map((payment) => (
        <PaymentRow key={payment.id} payment={payment} />
      ))}
    </ul>
  );
}

function PaymentRow({ payment }: { payment: Payment }) {
  const now = Date.now();
  const payable =
    payment.status === "PENDING" &&
    payment.checkoutUrl !== null &&
    payment.checkoutExpiresAt !== null &&
    Date.parse(payment.checkoutExpiresAt) > now;
  const refundable = payment.refundableUntil !== null && Date.parse(payment.refundableUntil) > now;

  return (
    <li className="payment-row">
      <div className="payment-row__main">
        <strong>{payment.planName ?? "باقة"}</strong>
        <span className="small muted">
          {formatDateTime(payment.paidAt ?? payment.createdAt)}
          <span aria-hidden="true"> · </span>
          <bdi dir="ltr">#{payment.id.slice(0, 8)}</bdi>
        </span>
        {refundable && payment.refundableUntil ? (
          <span className="small muted">
            يمكنك طلب استرجاع كامل المبلغ حتى {formatDateTime(payment.refundableUntil)} —{" "}
            <Link href="/refund">سياسة الاسترجاع</Link>
          </span>
        ) : null}
      </div>
      <span className="payment-row__amount">
        {formatPrice(payment.amount.amountMinor, payment.amount.currency)}
      </span>
      <span className={`status-badge status-badge--${payment.status.toLowerCase()}`}>
        {PAYMENT_STATUS_LABELS[payment.status]}
      </span>
      {payable && payment.checkoutUrl ? (
        <a className="btn btn--small" href={payment.checkoutUrl}>
          أكمل الدفع
        </a>
      ) : null}
    </li>
  );
}
