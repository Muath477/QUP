// Rendered only inside the client billing page, so no "use client" entry of its own.
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { type UseFormReturn, useForm, useWatch } from "react-hook-form";

import { ErrorNotice } from "@/components/status";
import type { AdminExam } from "@/lib/admin-api";
import type { AdminPlan, PlanChanges } from "@/lib/billing-admin-api";
import { createPlan, updatePlan } from "@/lib/billing-admin-api";
import {
  fromMinorUnits,
  PLAN_FORM_LIMITS,
  type PlanForm,
  type PlanFormInput,
  planFormSchema,
  SUGGESTED_FEATURES,
  toDurationDays,
  toMinorUnits,
  toOptionalMinorUnits,
} from "@/lib/billing-form";
import { useSingleFlight } from "../use-single-flight";

const DEFAULT_CURRENCY = "SAR";

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <span id={id} className="field__error" role="alert">
      {message}
    </span>
  ) : null;
}

type ContentForm = UseFormReturn<PlanFormInput, unknown, PlanForm>;

/** The fields a plan's content is edited with; shared by "new" and "edit". */
function PlanFields({
  form,
  exams,
  prefix,
  examsLocked,
}: {
  form: ContentForm;
  exams: readonly AdminExam[];
  prefix: string;
  /** An offered plan keeps its exams (the API refuses the change). */
  examsLocked: boolean;
}) {
  const errors = form.formState.errors;
  const id = (name: string) => `${prefix}-${name}`;
  const features = useWatch({ control: form.control, name: "features" });

  return (
    <>
      <fieldset className="field" aria-describedby={id("exams-hint")}>
        <legend className="field__label">الاختبارات التي تفتحها الباقة</legend>
        {examsLocked ? (
          // Not disabled inputs: react-hook-form drops their values. The ids stay in defaultValues.
          <ul className="plan-card__exams">
            {exams
              .filter((exam) => form.getValues("examIds").includes(exam.id))
              .map((exam) => (
                <li key={exam.id}>{exam.nameAr}</li>
              ))}
          </ul>
        ) : (
          <div className="check-group">
            {exams.map((exam) => (
              <label key={exam.id} className="check-field">
                <input type="checkbox" value={exam.id} {...form.register("examIds")} />
                {exam.nameAr}
              </label>
            ))}
          </div>
        )}
        <span id={id("exams-hint")} className="field__hint">
          {examsLocked
            ? "لا تتغير اختبارات باقة معروضة للبيع. لمنتج مختلف أنشئ باقة جديدة."
            : "اختر اختبارًا واحدًا لباقة مستقلة، أو عدة اختبارات لباقة شاملة."}
        </span>
        <FieldError id={id("exams-error")} message={errors.examIds?.message} />
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={id("name")}>
          اسم الباقة
        </label>
        <input id={id("name")} className="field__input" {...form.register("name")} />
        <FieldError id={id("name-error")} message={errors.name?.message} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id("description")}>
          وصف قصير <span className="muted">(اختياري)</span>
        </label>
        <input
          id={id("description")}
          className="field__input"
          maxLength={PLAN_FORM_LIMITS.maxDescriptionLength}
          {...form.register("description")}
        />
        <FieldError id={id("description-error")} message={errors.description?.message} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id("features")}>
          المميزات
        </label>
        <textarea
          id={id("features")}
          className="field__input"
          rows={6}
          aria-describedby={id("features-hint")}
          {...form.register("features")}
        />
        <span id={id("features-hint")} className="field__hint">
          ميزة في كل سطر، تظهر للطالب بنفس الترتيب. حتى {PLAN_FORM_LIMITS.maxFeatures} ميزة.{" "}
          {typeof features === "string" && features.trim() === "" ? (
            <button
              type="button"
              className="text-link"
              onClick={() =>
                form.setValue("features", SUGGESTED_FEATURES.join("\n"), { shouldDirty: true })
              }
            >
              استخدم المميزات المقترحة
            </button>
          ) : null}
        </span>
        <FieldError id={id("features-error")} message={errors.features?.message} />
      </div>

      <div className="admin-form__row">
        <div className="field">
          <label className="field__label" htmlFor={id("price")}>
            السعر (ر.س، شامل الضريبة)
          </label>
          <input
            id={id("price")}
            className="field__input"
            dir="ltr"
            inputMode="decimal"
            aria-invalid={errors.price ? true : undefined}
            {...form.register("price")}
          />
          <FieldError id={id("price-error")} message={errors.price?.message} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={id("compare")}>
            السعر قبل الخصم <span className="muted">(اختياري)</span>
          </label>
          <input
            id={id("compare")}
            className="field__input"
            dir="ltr"
            inputMode="decimal"
            aria-describedby={id("compare-hint")}
            {...form.register("compareAtPrice")}
          />
          <span id={id("compare-hint")} className="field__hint">
            يظهر مشطوبًا بجانب السعر.
          </span>
          <FieldError id={id("compare-error")} message={errors.compareAtPrice?.message} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={id("duration")}>
            المدة بالأيام
          </label>
          <input
            id={id("duration")}
            className="field__input"
            dir="ltr"
            inputMode="numeric"
            aria-describedby={id("duration-hint")}
            {...form.register("durationDays")}
          />
          <span id={id("duration-hint")} className="field__hint">
            اتركه فارغًا لوصول بلا نهاية.
          </span>
          <FieldError id={id("duration-error")} message={errors.durationDays?.message} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={id("order")}>
            ترتيب العرض
          </label>
          <input
            id={id("order")}
            className="field__input"
            dir="ltr"
            inputMode="numeric"
            aria-describedby={id("order-hint")}
            {...form.register("sortOrder")}
          />
          <span id={id("order-hint")} className="field__hint">
            الأصغر يظهر أولًا.
          </span>
          <FieldError id={id("order-error")} message={errors.sortOrder?.message} />
        </div>
      </div>

      <label className="check-field">
        <input type="checkbox" {...form.register("highlighted")} />
        اعرضها كالباقة الموصى بها («الأكثر اختيارًا»)
      </label>
    </>
  );
}

function contentFromForm(values: PlanForm) {
  return {
    examIds: values.examIds,
    name: values.name,
    description: values.description === "" ? null : values.description,
    features: values.features,
    highlighted: values.highlighted,
    sortOrder: Number(values.sortOrder),
    priceMinor: toMinorUnits(values.price),
    compareAtPriceMinor: toOptionalMinorUnits(values.compareAtPrice),
    durationDays: toDurationDays(values.durationDays),
  };
}

export function NewPlanForm({
  exams,
  onCreated,
}: {
  exams: readonly AdminExam[];
  onCreated: () => Promise<void>;
}) {
  const form = useForm<PlanFormInput, unknown, PlanForm>({
    resolver: zodResolver(planFormSchema),
    defaultValues: {
      examIds: [],
      code: "",
      name: "",
      description: "",
      features: "",
      highlighted: false,
      sortOrder: "0",
      price: "",
      compareAtPrice: "",
      durationDays: "",
    },
  });
  const send = useSingleFlight((values: PlanForm) =>
    createPlan({ ...contentFromForm(values), code: values.code, currency: DEFAULT_CURRENCY }),
  );
  const create = useMutation({
    mutationFn: send,
    onSuccess: async () => {
      form.reset();
      await onCreated();
    },
  });
  const errors = form.formState.errors;

  return (
    <form
      className="admin-form"
      noValidate
      onSubmit={form.handleSubmit((values) => create.mutate(values))}
    >
      {create.isError ? <ErrorNotice error={create.error} /> : null}
      {create.isSuccess ? (
        <p className="notice notice--success" role="status">
          أُنشئت الباقة مسودة. اعرضها للبيع من القائمة أعلاه حين تكون جاهزة.
        </p>
      ) : null}
      <PlanFields form={form} exams={exams} prefix="new-plan" examsLocked={false} />
      <div className="field">
        <label className="field__label" htmlFor="new-plan-code">
          الرمز
        </label>
        <input
          id="new-plan-code"
          className="field__input"
          dir="ltr"
          aria-describedby="new-plan-code-hint"
          {...form.register("code")}
        />
        <span id="new-plan-code-hint" className="field__hint">
          فريد ولا يتغير، مثل QUDURAT-90 أو ALL-EXAMS.
        </span>
        <FieldError id="new-plan-code-error" message={errors.code?.message} />
      </div>
      <button type="submit" className="btn" disabled={create.isPending}>
        {create.isPending ? "جارٍ الإنشاء…" : "إنشاء الباقة"}
      </button>
    </form>
  );
}

export function EditPlanForm({
  plan,
  exams,
  onDone,
  onCancel,
}: {
  plan: AdminPlan;
  exams: readonly AdminExam[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const form = useForm<PlanFormInput, unknown, PlanForm>({
    resolver: zodResolver(planFormSchema),
    defaultValues: {
      code: plan.code,
      examIds: plan.examIds,
      name: plan.name,
      description: plan.description ?? "",
      features: plan.features.join("\n"),
      highlighted: plan.highlighted,
      sortOrder: String(plan.sortOrder),
      price: fromMinorUnits(plan.price.amountMinor),
      compareAtPrice: plan.compareAtPrice ? fromMinorUnits(plan.compareAtPrice.amountMinor) : "",
      durationDays: plan.durationDays === null ? "" : String(plan.durationDays),
    },
  });
  const offered = plan.status === "ACTIVE";
  const send = useSingleFlight((values: PlanForm) => {
    const { examIds, ...rest } = contentFromForm(values);
    const changes: PlanChanges = offered ? rest : { ...rest, examIds };
    return updatePlan(plan.id, changes);
  });
  const save = useMutation({ mutationFn: send, onSuccess: onDone });
  const price = useWatch({ control: form.control, name: "price" });
  const repriced = offered && price !== fromMinorUnits(plan.price.amountMinor);

  return (
    <form
      className="admin-form"
      noValidate
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
      {save.isError ? <ErrorNotice error={save.error} /> : null}
      <PlanFields form={form} exams={exams} prefix={`edit-${plan.id}`} examsLocked={offered} />
      {repriced ? (
        <p className="notice" role="status">
          السعر الجديد يسري على من يشتري بعد الحفظ. من اشترك سابقًا لا يتأثر، ومن فتح صفحة دفع بالسعر
          القديم يُعرض عليه السعر الجديد عند محاولته التالية. يُسجَّل التغيير في سجل التدقيق.
        </p>
      ) : null}
      <div className="admin-form__actions row">
        <button type="submit" className="btn btn--small" disabled={save.isPending}>
          {save.isPending ? "جارٍ الحفظ…" : "حفظ"}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onCancel}>
          إلغاء
        </button>
      </div>
    </form>
  );
}
