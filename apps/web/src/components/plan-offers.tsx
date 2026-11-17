"use client";

import { type UseQueryResult, useMutation, useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRef } from "react";
import {
  checkout,
  type ExamAccess,
  getExamAccess,
  listPlanCatalog,
  listPlans,
  type PlanOffer,
} from "@/lib/api";
import { durationText } from "@/lib/billing-form";
import { formatDate } from "@/lib/format";
import { REFUND_WINDOW_HOURS } from "@/lib/legal";
import { formatPrice } from "@/lib/messages";
import { useCurrentUser } from "@/lib/session";
import { EmptyState } from "./empty-state";
import { Icon } from "./icon";
import { ErrorNotice, Loading } from "./status";

/** Plans on sale that unlock one exam (its own and the bundles with it). */
export function PlanOffers({ examId }: { examId: string }) {
  const { data: user } = useCurrentUser();
  const plans = useQuery({
    queryKey: ["plans", user?.id, examId],
    queryFn: () => listPlans(examId),
    enabled: !!user,
  });
  return <PlanList plans={plans} userId={user?.id} />;
}

/** Every plan on sale: the pricing page. */
export function PlanCatalog() {
  const { data: user } = useCurrentUser();
  const plans = useQuery({
    queryKey: ["plan-catalog", user?.id],
    queryFn: listPlanCatalog,
    enabled: !!user,
  });
  return <PlanList plans={plans} userId={user?.id} />;
}

type PlansQuery = UseQueryResult<{ items: PlanOffer[] }>;

function PlanList({ plans, userId }: { plans: PlansQuery; userId: string | undefined }) {
  const examIds = [...new Set((plans.data?.items ?? []).flatMap((p) => p.exams.map((e) => e.id)))];
  const access = useQueries({
    queries: examIds.map((examId) => ({
      queryKey: ["exam-access", userId, examId],
      queryFn: () => getExamAccess(examId),
      enabled: !!userId,
    })),
  });
  const accessByExam = new Map(
    access.flatMap((query) => (query.data ? [[query.data.examId, query.data] as const] : [])),
  );

  const keys = useRef(new Map<string, string>());
  const pay = useMutation({
    mutationFn: (plan: PlanOffer) => {
      // One key per plan for this page: a double click or a retry reuses the same checkout.
      const key = keys.current.get(plan.id) ?? crypto.randomUUID();
      keys.current.set(plan.id, key);
      return checkout(plan.id, key);
    },
    onSuccess: (payment) => {
      if (payment.checkoutUrl) window.location.assign(payment.checkoutUrl);
    },
  });

  const accessFailed = access.find((query) => query.isError);
  if (plans.isPending || access.some((query) => query.isPending)) {
    return <Loading label="جارٍ تحميل الباقات…" />;
  }
  if (plans.isError || accessFailed) {
    return (
      <ErrorNotice error={plans.error ?? accessFailed?.error}>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            void plans.refetch();
            for (const query of access) void query.refetch();
          }}
        >
          إعادة المحاولة
        </button>
      </ErrorNotice>
    );
  }
  if (plans.data.items.length === 0) {
    return (
      <EmptyState
        title="الباقات غير متاحة حاليًا"
        description="يمكنك البدء بالتشخيص المصغّر المجاني. ستظهر الباقات هنا فور إتاحتها."
        icon="credit"
      />
    );
  }

  return (
    <div className="stack stack--loose">
      {pay.isError ? <ErrorNotice error={pay.error} /> : null}
      {pay.isSuccess && !pay.data.checkoutUrl ? (
        <p className="notice" role="status">
          لم يصل رابط دفع صالح. راجع حالة العملية أو أعد تحميل الصفحة قبل المحاولة مجددًا.
        </p>
      ) : null}
      <ul className="plan-grid">
        {plans.data.items.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            access={plan.exams.map((exam) => accessByExam.get(exam.id))}
            busy={pay.isPending || pay.isSuccess}
            buying={pay.isPending && pay.variables?.id === plan.id}
            onBuy={() => pay.mutate(plan)}
          />
        ))}
      </ul>
      <p className="plan-terms small muted">
        يمكنك استرجاع كامل المبلغ خلال {REFUND_WINDOW_HOURS} ساعة من تفعيل الاشتراك. لا يتجدد
        الاشتراك تلقائيًا. بالاشتراك فإنك توافق على{" "}
        <Link href="/terms" target="_blank">
          الشروط والأحكام
        </Link>{" "}
        و
        <Link href="/refund" target="_blank">
          سياسة الاسترجاع
        </Link>
        .
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  access,
  busy,
  buying,
  onBuy,
}: {
  plan: PlanOffer;
  access: (ExamAccess | undefined)[];
  busy: boolean;
  buying: boolean;
  onBuy: () => void;
}) {
  const owned = access.length > 0 && access.every((a) => a?.hasAccess);
  const ownedSome = plan.exams.filter((_, index) => access[index]?.hasAccess);
  const headingId = `plan-${plan.id}`;

  return (
    <li
      className={`plan-card${plan.highlighted ? " plan-card--highlighted" : ""}`}
      aria-labelledby={headingId}
    >
      {plan.highlighted ? <span className="plan-card__ribbon">الأكثر اختيارًا</span> : null}
      <div className="plan-card__head">
        <h3 id={headingId}>{plan.name}</h3>
        {plan.description ? <p className="plan-card__pitch">{plan.description}</p> : null}
      </div>

      <ul className="plan-card__exams" aria-label="يشمل">
        {plan.exams.map((exam) => (
          <li key={exam.id}>{exam.nameAr}</li>
        ))}
      </ul>

      <p className="plan-price">
        <span>{formatPrice(plan.price.amountMinor, plan.price.currency)}</span>
        {plan.compareAtPrice ? (
          <s className="plan-price__was">
            <span className="visually-hidden">بدلًا من </span>
            {formatPrice(plan.compareAtPrice.amountMinor, plan.compareAtPrice.currency)}
          </s>
        ) : null}
      </p>
      <p className="plan-duration">
        {plan.durationDays === null
          ? "وصول بلا تاريخ انتهاء"
          : `لمدة ${durationText(plan.durationDays)} من التفعيل`}
      </p>

      {plan.features.length > 0 ? (
        <ul className="plan-card__features">
          {plan.features.map((feature) => (
            <li key={feature}>
              <Icon name="check" />
              {feature}
            </li>
          ))}
        </ul>
      ) : null}

      {owned ? (
        <p className="plan-card__owned" role="status">
          <Icon name="check" />
          {ownedUntil(access)}
        </p>
      ) : (
        <>
          {ownedSome.length > 0 ? (
            <p className="small muted">
              لديك اشتراك قائم في {ownedSome.map((exam) => exam.nameAr).join(" و")}؛ تبدأ مدته في
              هذه الباقة بعد انتهاء اشتراكك الحالي، فلا تخسر أي يوم.
            </p>
          ) : null}
          <button type="button" className="btn" disabled={busy} onClick={onBuy}>
            {buying ? "جارٍ التحويل للدفع…" : "اشترك الآن"}
            <Icon name="arrow" />
          </button>
        </>
      )}
    </li>
  );
}

/** The earliest end among the covered exams: that is when the plan stops being whole. */
function ownedUntil(access: (ExamAccess | undefined)[]): string {
  const ends = access.flatMap((a) => (a?.activeUntil ? [Date.parse(a.activeUntil)] : []));
  return ends.length === 0
    ? "مشترك بلا تاريخ انتهاء"
    : `مشترك حتى ${formatDate(new Date(Math.min(...ends)))}`;
}
