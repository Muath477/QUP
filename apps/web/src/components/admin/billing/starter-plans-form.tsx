// Rendered only inside the client billing page.
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { ErrorNotice } from "@/components/status";
import type { AdminExam } from "@/lib/admin-api";
import { normalizeDigits } from "@/lib/admin-forms";
import { isApiError } from "@/lib/api";
import { createPlan } from "@/lib/billing-admin-api";
import { toDurationDays, toMinorUnits } from "@/lib/billing-form";
import { type StarterPrices, starterPlans } from "@/lib/starter-plans";

const PRICE_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;
const DURATION_PATTERN = /^\d{1,4}$/;
const MAX_DAYS = 3650;

/**
 * Creates the standard package set in one go — one plan per exam that is not
 * archived, plus a bundle of all of them — as drafts with the admin's prices.
 * Each is then reviewed and offered from the list like any other plan.
 */
export function StarterPlansForm({
  exams,
  onCreated,
}: {
  exams: readonly AdminExam[];
  onCreated: () => Promise<void>;
}) {
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [bundle, setBundle] = useState("");
  const [duration, setDuration] = useState("365");
  const [problem, setProblem] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async (input: StarterPrices) => {
      const plans = starterPlans(exams, input);
      let skipped = 0;
      // One by one: each is its own draft; a code that already exists is left as it is.
      for (const plan of plans) {
        try {
          await createPlan(plan);
        } catch (error) {
          if (!isApiError(error, "PLAN_CODE_TAKEN")) throw error;
          skipped += 1;
        }
      }
      return { created: plans.length - skipped, skipped };
    },
    onSuccess: onCreated,
  });

  function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    const perExam = exams.map((exam) => [exam.id, normalizeDigits(prices[exam.id] ?? "")] as const);
    const bundlePrice = normalizeDigits(bundle);
    const needed = [
      ...perExam.map(([, value]) => value),
      ...(exams.length > 1 ? [bundlePrice] : []),
    ];
    if (needed.some((value) => !PRICE_PATTERN.test(value))) {
      setProblem("اكتب سعر كل باقة بالريال، حتى منزلتين عشريتين.");
      return;
    }
    const days = normalizeDigits(duration);
    if (
      days !== "" &&
      (!DURATION_PATTERN.test(days) || Number(days) < 1 || Number(days) > MAX_DAYS)
    ) {
      setProblem("المدة عدد أيام من 1 إلى 3650، أو اتركها فارغة لوصول بلا نهاية.");
      return;
    }
    setProblem(null);
    create.mutate({
      perExam: Object.fromEntries(perExam.map(([id, value]) => [id, toMinorUnits(value)])),
      bundle: exams.length > 1 ? toMinorUnits(bundlePrice) : 0,
      durationDays: toDurationDays(days),
    });
  }

  if (exams.length === 0) {
    return <p className="small muted">أنشئ الاختبارات أولًا من صفحة الاختبارات.</p>;
  }

  return (
    <form className="admin-form" noValidate onSubmit={submit}>
      <p className="small muted">
        تُنشأ {exams.length > 1 ? `${exams.length + 1} باقات` : "باقة"} مسوّدةً: باقة لكل اختبار
        {exams.length > 1 ? "، وباقة شاملة لها كلها" : ""}، بالمميزات المقترحة. راجع كل باقة ثم
        اعرضها للبيع. إن وُجدت باقة بنفس الرمز تُترك كما هي.
      </p>
      {problem ? (
        <p className="notice notice--error" role="alert">
          {problem}
        </p>
      ) : null}
      {create.isError ? <ErrorNotice error={create.error} /> : null}
      {create.isSuccess ? (
        <p className="notice notice--success" role="status">
          أُنشئت {create.data.created} باقة مسودة
          {create.data.skipped > 0 ? `، وتُركت ${create.data.skipped} موجودة من قبل` : ""}. راجعها في
          القائمة أعلاه ثم اعرضها للبيع.
        </p>
      ) : null}
      <div className="admin-form__row">
        {exams.map((exam) => (
          <div className="field" key={exam.id}>
            <label className="field__label" htmlFor={`starter-${exam.id}`}>
              سعر باقة {exam.nameAr} (ر.س)
            </label>
            <input
              id={`starter-${exam.id}`}
              className="field__input"
              dir="ltr"
              inputMode="decimal"
              value={prices[exam.id] ?? ""}
              onChange={(event) => setPrices({ ...prices, [exam.id]: event.target.value })}
            />
          </div>
        ))}
        {exams.length > 1 ? (
          <div className="field">
            <label className="field__label" htmlFor="starter-bundle">
              سعر الباقة الشاملة (ر.س)
            </label>
            <input
              id="starter-bundle"
              className="field__input"
              dir="ltr"
              inputMode="decimal"
              aria-describedby="starter-bundle-hint"
              value={bundle}
              onChange={(event) => setBundle(event.target.value)}
            />
            <span id="starter-bundle-hint" className="field__hint">
              إن كان أقل من مجموع الباقات، يظهر المجموع مشطوبًا بجانبه.
            </span>
          </div>
        ) : null}
        <div className="field">
          <label className="field__label" htmlFor="starter-duration">
            المدة بالأيام
          </label>
          <input
            id="starter-duration"
            className="field__input"
            dir="ltr"
            inputMode="numeric"
            aria-describedby="starter-duration-hint"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
          <span id="starter-duration-hint" className="field__hint">
            للباقات كلها؛ تُعدَّل لكل باقة لاحقًا. فارغ = بلا نهاية.
          </span>
        </div>
      </div>
      <button type="submit" className="btn" disabled={create.isPending}>
        {create.isPending ? "جارٍ الإنشاء…" : "أنشئ الباقات"}
      </button>
    </form>
  );
}
