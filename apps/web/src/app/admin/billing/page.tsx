"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AdminGate } from "@/components/admin/admin-gate";
import { PaymentsLedger, RevenueSummaryCard } from "@/components/admin/billing/payments-ledger";
import { EditPlanForm, NewPlanForm } from "@/components/admin/billing/plan-editor";
import { StarterPlansForm } from "@/components/admin/billing/starter-plans-form";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { useSingleFlight } from "@/components/admin/use-single-flight";
import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice, Loading } from "@/components/status";
import { type AdminExam, listAdminExams } from "@/lib/admin-api";
import {
  type AdminEntitlement,
  type AdminPlan,
  activatePlan,
  ENTITLEMENT_SOURCE_LABELS,
  ENTITLEMENT_STATUS_LABELS,
  grantEntitlement,
  listAdminPlans,
  lookupStudent,
  PLAN_STATUS_LABELS,
  type PlanStatus,
  retirePlan,
  revokeEntitlement,
  type StudentLookup,
} from "@/lib/billing-admin-api";
import {
  durationText,
  type GrantForm,
  type GrantFormInput,
  grantFormSchema,
  toDurationDays,
} from "@/lib/billing-form";
import { formatDate } from "@/lib/format";
import { formatPrice } from "@/lib/messages";
import { ADMIN_PERMISSIONS } from "@/lib/permissions";

export default function AdminBillingPage() {
  return (
    <AdminGate permission={ADMIN_PERMISSIONS.billingManage}>
      {(me) => <Billing userId={me.user.id} />}
    </AdminGate>
  );
}

function Billing({ userId }: { userId: string }) {
  const exams = useQuery({ queryKey: ["admin-exams", userId], queryFn: listAdminExams });
  const examList = (exams.data?.items ?? []).filter((exam) => exam.status !== "ARCHIVED");
  return (
    <main id="main-content" className="page stack stack--loose">
      <PageHeading
        title="الباقات والمدفوعات"
        description="أنشئ باقة لكل اختبار أو باقة شاملة لعدة اختبارات، وحدد أسعارها ومميزاتها، وتابع المدفوعات، وامنح الطلاب وصولًا يدويًا أو ألغِه. كل تغيير في سعر أو حالة يُسجَّل في سجل التدقيق."
      />
      {exams.isError ? <ErrorNotice error={exams.error} /> : null}
      <RevenueSummaryCard userId={userId} />
      <Plans userId={userId} exams={examList} />
      <PaymentsLedger userId={userId} />
      <Access exams={examList} />
    </main>
  );
}

function examName(exams: readonly AdminExam[], examId: string): string {
  return exams.find((exam) => exam.id === examId)?.nameAr ?? "اختبار غير معروف";
}

function PlanBadge({ status }: { status: PlanStatus }) {
  return (
    <span className={`status-badge status-badge--${status.toLowerCase()}`}>
      {PLAN_STATUS_LABELS[status]}
    </span>
  );
}

function Plans({ userId, exams }: { userId: string; exams: readonly AdminExam[] }) {
  const queryClient = useQueryClient();
  const plans = useQuery({ queryKey: ["admin-plans", userId], queryFn: listAdminPlans });
  const [examFilter, setExamFilter] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-plans", userId] });
  const all = plans.data?.items ?? [];
  const shown = all.filter((plan) => examFilter === "" || plan.examIds.includes(examFilter));

  return (
    <>
      <section className="card stack" aria-labelledby="plans-heading">
        <div className="section-head">
          <h2 id="plans-heading">الباقات</h2>
          <label className="inline-field">
            <span className="small muted">الاختبار</span>
            <select
              className="field__input"
              value={examFilter}
              onChange={(event) => setExamFilter(event.target.value)}
            >
              <option value="">كل الاختبارات</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.nameAr}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="small muted">
          الباقة تبدأ مسودة لا يراها الطلاب. بعد عرضها للبيع يمكنك تعديل سعرها ومدتها ومميزاتها
          ووصفها في أي وقت: السعر الجديد للمشترين الجدد فقط، ومن اشترك سابقًا يحتفظ بما دفع واشترى.
          الاختبارات التي تشملها الباقة تُثبَّت عند عرضها. إيقاف البيع لا يمس اشتراكات من اشتروها.
        </p>
        {plans.isPending ? <Loading /> : null}
        {plans.isError ? <ErrorNotice error={plans.error} /> : null}
        {plans.data && shown.length === 0 ? (
          <EmptyState
            title="لا توجد باقات بعد"
            description="ابدأ بالباقات الأساسية من النموذج أدناه، أو أنشئ باقة بنفسك."
          />
        ) : null}
        {shown.length > 0 ? (
          <ul className="list">
            {shown.map((plan) => (
              <PlanRow
                key={plan.id}
                userId={userId}
                plan={plan}
                exams={exams}
                onChanged={refresh}
              />
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="starter-heading">
        <h2 id="starter-heading">الباقات الأساسية</h2>
        <StarterPlansForm exams={exams} onCreated={refresh} />
      </section>

      <section className="card stack" aria-labelledby="new-plan-heading">
        <h2 id="new-plan-heading">باقة جديدة</h2>
        <NewPlanForm exams={exams} onCreated={refresh} />
      </section>
    </>
  );
}

function PlanRow({
  userId,
  plan,
  exams,
  onChanged,
}: {
  userId: string;
  plan: AdminPlan;
  exams: readonly AdminExam[];
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const refresh = async () => {
    await onChanged();
    // The ledger names plans; a rename shows there too.
    await queryClient.invalidateQueries({ queryKey: ["admin-payments", userId] });
  };
  const activate = useMutation({ mutationFn: () => activatePlan(plan.id), onSuccess: refresh });
  const retire = useMutation({ mutationFn: () => retirePlan(plan.id), onSuccess: refresh });
  const covers = plan.examIds.map((id) => examName(exams, id)).join(" · ");

  return (
    <li className="admin-row admin-row--stacked">
      <div className="admin-row__line">
        <span className="admin-row__main">
          <strong>
            {plan.name}
            {plan.highlighted ? <span className="badge">موصى بها</span> : null}
          </strong>
          <span className="small muted">
            {plan.examIds.length > 1 ? `باقة شاملة: ${covers}` : covers}
          </span>
          <span className="small muted" dir="ltr">
            {plan.code}
          </span>
        </span>
        <span className="plan-figure">
          {formatPrice(plan.price.amountMinor, plan.price.currency)}
          {plan.compareAtPrice ? (
            <s className="plan-price__was">
              {formatPrice(plan.compareAtPrice.amountMinor, plan.compareAtPrice.currency)}
            </s>
          ) : null}
        </span>
        <span className="small muted">{durationText(plan.durationDays)}</span>
        <span className="small muted">
          {plan.features.length === 0 ? "بلا مميزات" : `${plan.features.length} ميزة`}
        </span>
        <PlanBadge status={plan.status} />
      </div>

      {activate.isError ? <ErrorNotice error={activate.error} /> : null}
      {retire.isError ? <ErrorNotice error={retire.error} /> : null}

      {mode === "edit" ? (
        <EditPlanForm
          plan={plan}
          exams={exams}
          onDone={async () => {
            setMode("view");
            await refresh();
          }}
          onCancel={() => setMode("view")}
        />
      ) : null}

      {mode === "view" && plan.status !== "RETIRED" ? (
        <div className="row">
          {plan.status === "DRAFT" ? (
            <button
              type="button"
              className="btn btn--small"
              disabled={activate.isPending}
              onClick={() => activate.mutate()}
            >
              {activate.isPending ? "جارٍ العرض…" : "اعرضها للبيع"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => setMode("edit")}
          >
            {plan.status === "ACTIVE" ? "تعديل السعر والمميزات" : "تعديل"}
          </button>
          {plan.status === "ACTIVE" ? (
            <ConfirmAction
              label="إيقاف البيع"
              description={`سيتوقف بيع «${plan.name}» نهائيًا. من اشترك بها يحتفظ باشتراكه حتى نهايته.`}
              confirmLabel="أوقف البيع"
              danger
              pending={retire.isPending}
              onConfirm={() => retire.mutate()}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <span id={id} className="field__error" role="alert">
      {message}
    </span>
  ) : null;
}

function Access({ exams }: { exams: readonly AdminExam[] }) {
  const [identifier, setIdentifier] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const lookup = useQuery({
    queryKey: ["admin-student-lookup", searched],
    queryFn: () => lookupStudent(searched ?? ""),
    enabled: searched !== null,
    retry: false,
  });

  return (
    <section className="card stack" aria-labelledby="access-heading">
      <h2 id="access-heading">وصول الطلاب</h2>
      <p className="small muted">
        ابحث عن الطالب ببريده الإلكتروني أو رقم جواله كما سجّل به، لترى اشتراكاته وتمنحه وصولًا أو
        تلغيه.
      </p>
      <form
        className="lookup-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = identifier.trim();
          if (value) setSearched(value);
        }}
      >
        <label className="visually-hidden" htmlFor="student-identifier">
          البريد الإلكتروني أو رقم الجوال
        </label>
        <input
          id="student-identifier"
          className="field__input"
          dir="ltr"
          placeholder="student@example.com أو ‎+9665XXXXXXXX"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />
        <button type="submit" className="btn" disabled={lookup.isFetching}>
          {lookup.isFetching ? "جارٍ البحث…" : "بحث"}
        </button>
      </form>
      {lookup.isError ? <ErrorNotice error={lookup.error} /> : null}
      {lookup.data ? (
        <StudentAccess
          key={lookup.data.student.id}
          found={lookup.data}
          exams={exams}
          searched={searched ?? ""}
        />
      ) : null}
    </section>
  );
}

function StudentAccess({
  found,
  exams,
  searched,
}: {
  found: StudentLookup;
  exams: readonly AdminExam[];
  searched: string;
}) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-student-lookup", searched] });
  const { student, entitlements } = found;
  return (
    <div className="stack">
      <div className="student-card">
        <span className="user-avatar" aria-hidden="true">
          {student.displayName?.trim().charAt(0) || "؟"}
        </span>
        <div>
          <strong>{student.displayName ?? "بدون اسم"}</strong>
          <span className="small muted" dir="ltr">
            {[student.email, student.phone].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      <h3>الاشتراكات</h3>
      {entitlements.length === 0 ? (
        <p className="small muted">لا توجد اشتراكات لهذا الطالب.</p>
      ) : (
        <ul className="list">
          {entitlements.map((entitlement) => (
            <EntitlementRow
              key={entitlement.id}
              entitlement={entitlement}
              examName={examName(exams, entitlement.examId)}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
      <h3>منح وصول</h3>
      <GrantAccessForm studentId={student.id} exams={exams} onGranted={refresh} />
    </div>
  );
}

function EntitlementRow({
  entitlement,
  examName,
  onChanged,
}: {
  entitlement: AdminEntitlement;
  examName: string;
  onChanged: () => Promise<void>;
}) {
  const revoke = useMutation({
    mutationFn: () => revokeEntitlement(entitlement.id),
    onSuccess: onChanged,
  });
  const period = `${formatDate(entitlement.startsAt)} — ${entitlement.endsAt ? formatDate(entitlement.endsAt) : "بلا نهاية"}`;
  return (
    <li className="admin-row admin-row--stacked">
      <div className="admin-row__line">
        <span className="admin-row__main">
          <strong>{examName}</strong>
          <span className="small muted">{ENTITLEMENT_SOURCE_LABELS[entitlement.source]}</span>
          <span className="small muted">{period}</span>
        </span>
        <span className={`status-badge status-badge--${entitlement.status.toLowerCase()}`}>
          {ENTITLEMENT_STATUS_LABELS[entitlement.status]}
        </span>
        {entitlement.status === "ACTIVE" ? (
          <ConfirmAction
            label="إلغاء الوصول"
            description="سيفقد الطالب مزايا الباقة في هذا الاختبار فورًا، وتبقى إجاباته وملف مهاراته محفوظة. إن كان له وصول آخر مجدول بعد هذا، فلن يتقدّم موعد بدايته؛ امنحه وصولًا جديدًا إن لزم."
            confirmLabel="ألغِ الوصول"
            danger
            pending={revoke.isPending}
            onConfirm={() => revoke.mutate()}
          />
        ) : null}
      </div>
      {revoke.isError ? <ErrorNotice error={revoke.error} /> : null}
    </li>
  );
}

function GrantAccessForm({
  studentId,
  exams,
  onGranted,
}: {
  studentId: string;
  exams: readonly AdminExam[];
  onGranted: () => Promise<void>;
}) {
  const form = useForm<GrantFormInput, unknown, GrantForm>({
    resolver: zodResolver(grantFormSchema),
    defaultValues: { examId: "", durationDays: "30" },
  });
  const send = useSingleFlight((values: GrantForm) =>
    grantEntitlement({
      studentId,
      examId: values.examId,
      durationDays: toDurationDays(values.durationDays),
    }),
  );
  const grant = useMutation({
    mutationFn: send,
    onSuccess: async () => {
      form.reset();
      await onGranted();
    },
  });
  const errors = form.formState.errors;
  return (
    <form
      className="admin-form"
      noValidate
      onSubmit={form.handleSubmit((values) => grant.mutate(values))}
    >
      {grant.isError ? <ErrorNotice error={grant.error} /> : null}
      {grant.isSuccess ? (
        <p className="notice notice--success" role="status">
          مُنح الوصول. إن كان للطالب وصول قائم، يبدأ الجديد بعد انتهائه.
        </p>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor="grant-exam">
          الاختبار
        </label>
        <select id="grant-exam" className="field__input" {...form.register("examId")}>
          <option value="">— اختر —</option>
          {exams.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.nameAr}
            </option>
          ))}
        </select>
        <FieldError id="grant-exam-error" message={errors.examId?.message} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="grant-duration">
          المدة بالأيام
        </label>
        <input
          id="grant-duration"
          className="field__input"
          dir="ltr"
          inputMode="numeric"
          aria-describedby="grant-duration-hint"
          {...form.register("durationDays")}
        />
        <span id="grant-duration-hint" className="field__hint">
          اتركه فارغًا لوصول بلا نهاية.
        </span>
        <FieldError id="grant-duration-error" message={errors.durationDays?.message} />
      </div>
      <button type="submit" className="btn" disabled={grant.isPending}>
        {grant.isPending ? "جارٍ المنح…" : "امنح الوصول"}
      </button>
    </form>
  );
}
