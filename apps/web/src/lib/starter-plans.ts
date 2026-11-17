import type { AdminExam } from "./admin-api";
import type { CreatePlanInput } from "./billing-admin-api";
import { SUGGESTED_FEATURES } from "./billing-form";

const CURRENCY = "SAR";
/** The bundle's code. Stable, so a second run is refused as a duplicate, not doubled. */
export const BUNDLE_CODE = "ALL-EXAMS";
const BUNDLE_SORT_ORDER = 100;

export interface StarterPrices {
  /** Minor units per exam id. */
  perExam: Record<string, number>;
  bundle: number;
  durationDays: number | null;
}

/**
 * The Product Owner's package set (2026-11-16): one plan per exam, plus one
 * bundle covering all of them — e.g. Qudurat, Tahsili, STEP and "all three".
 * Built from the exams that exist, never from names written into code. All
 * are created as drafts: nothing is on sale until the admin offers it.
 */
export function starterPlans(
  exams: readonly AdminExam[],
  prices: StarterPrices,
): CreatePlanInput[] {
  const features = [...SUGGESTED_FEATURES];
  const single = exams.map(
    (exam, index): CreatePlanInput => ({
      examIds: [exam.id],
      code: `${exam.code}-PLAN`.slice(0, 64),
      name: `باقة ${exam.nameAr}`,
      description: `كل ما تحتاجه لاختبار ${exam.nameAr} في مكان واحد.`,
      features,
      highlighted: false,
      sortOrder: index + 1,
      priceMinor: prices.perExam[exam.id] ?? 0,
      compareAtPriceMinor: null,
      currency: CURRENCY,
      durationDays: prices.durationDays,
    }),
  );
  if (exams.length < 2) return single;

  const bundle: CreatePlanInput = {
    examIds: exams.map((exam) => exam.id),
    code: BUNDLE_CODE,
    name: "الباقة الشاملة",
    description: `${exams.map((exam) => exam.nameAr).join(" و")} معًا بسعر واحد.`,
    features: [`كل ما في باقات ${exams.map((exam) => exam.nameAr).join(" و")}`, ...features],
    highlighted: true,
    sortOrder: BUNDLE_SORT_ORDER,
    priceMinor: prices.bundle,
    // Shown struck-through only if the bundle really costs less than buying each.
    compareAtPriceMinor: null,
    currency: CURRENCY,
    durationDays: prices.durationDays,
  };
  const separately = single.reduce((sum, plan) => sum + plan.priceMinor, 0);
  if (separately > prices.bundle) bundle.compareAtPriceMinor = separately;
  return [...single, bundle];
}
