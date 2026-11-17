import { z } from "zod";

import { normalizeDigits } from "./admin-forms";

const MINOR_UNITS = 100;
const MAX_DURATION_DAYS = 3650;
/** Mirrors the API's limits (plan-rules.ts), so the form explains them before the server refuses. */
export const PLAN_FORM_LIMITS = {
  maxDescriptionLength: 300,
  maxFeatures: 12,
  maxFeatureLength: 160,
  maxSortOrder: 1_000_000,
} as const;

const PRICE_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

const price = z
  .string()
  .transform(normalizeDigits)
  .refine((value) => PRICE_PATTERN.test(value), "مبلغ بالريال، حتى منزلتين عشريتين");

const optionalPrice = z
  .string()
  .transform(normalizeDigits)
  .refine(
    (value) => value === "" || PRICE_PATTERN.test(value),
    "مبلغ بالريال، أو اتركه فارغًا إن لم يكن هناك خصم",
  );

const duration = z
  .string()
  .transform(normalizeDigits)
  .refine(
    (value) =>
      value === "" ||
      (/^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_DURATION_DAYS),
    "عدد أيام من 1 إلى 3650، أو اتركه فارغًا لوصول بلا نهاية",
  );

const features = z
  .string()
  .transform((text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  )
  .refine(
    (lines) => lines.length <= PLAN_FORM_LIMITS.maxFeatures,
    `حتى ${PLAN_FORM_LIMITS.maxFeatures} ميزة`,
  )
  .refine(
    (lines) => lines.every((line) => line.length <= PLAN_FORM_LIMITS.maxFeatureLength),
    `كل ميزة حتى ${PLAN_FORM_LIMITS.maxFeatureLength} حرفًا`,
  );

const sortOrder = z
  .string()
  .transform(normalizeDigits)
  .refine(
    (value) => /^\d{1,7}$/.test(value) && Number(value) <= PLAN_FORM_LIMITS.maxSortOrder,
    "رقم صحيح، الأصغر يظهر أولًا",
  );

const planContentSchema = z.object({
  examIds: z.array(z.string()).min(1, "اختر اختبارًا واحدًا على الأقل"),
  name: z.string().trim().min(1, "اكتب اسم الباقة").max(200),
  description: z.string().trim().max(PLAN_FORM_LIMITS.maxDescriptionLength),
  features,
  highlighted: z.boolean(),
  sortOrder,
  price,
  compareAtPrice: optionalPrice,
  durationDays: duration,
});

/** The "was" price must be above the price — the same rule the API enforces. */
function compareAtAbovePrice(values: { price: string; compareAtPrice: string }): boolean {
  return (
    values.compareAtPrice === "" || toMinorUnits(values.compareAtPrice) > toMinorUnits(values.price)
  );
}
const COMPARE_AT_MESSAGE = {
  message: "السعر قبل الخصم يجب أن يكون أعلى من السعر",
  path: ["compareAtPrice"],
};

/**
 * One schema for creating and editing, so both forms share their fields. The
 * edit form carries the plan's code unchanged and never sends it: a code is
 * fixed for life.
 */
export const planFormSchema = planContentSchema
  .extend({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_.-]{0,63}$/, "حروف إنجليزية كبيرة وأرقام و _ . - فقط"),
  })
  .refine(compareAtAbovePrice, COMPARE_AT_MESSAGE);
export type PlanFormInput = z.input<typeof planFormSchema>;
export type PlanForm = z.output<typeof planFormSchema>;

export const grantFormSchema = z.object({
  examId: z.string().min(1, "اختر الاختبار"),
  durationDays: duration,
});
export type GrantFormInput = z.input<typeof grantFormSchema>;
export type GrantForm = z.output<typeof grantFormSchema>;

export function toMinorUnits(riyals: string): number {
  const [whole = "0", fraction = ""] = riyals.split(".");
  return Number(whole) * MINOR_UNITS + Number(fraction.padEnd(2, "0"));
}

export function fromMinorUnits(amountMinor: number): string {
  const whole = Math.floor(amountMinor / MINOR_UNITS);
  const fraction = amountMinor % MINOR_UNITS;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

export function toOptionalMinorUnits(riyals: string): number | null {
  return riyals === "" ? null : toMinorUnits(riyals);
}

export function toDurationDays(value: string): number | null {
  return value === "" ? null : Number(value);
}

export function durationText(days: number | null): string {
  if (days === null) return "بلا نهاية";
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومان";
  if (days <= 10) return `${days} أيام`;
  return `${days} يومًا`;
}

/**
 * Starting wording for a new plan's features. Only what every plan gives in
 * this product today (PRD §7–8); the admin edits it before offering the plan.
 */
export const SUGGESTED_FEATURES = [
  "التشخيص الكامل لكل مهارات الاختبار",
  "ملف مهارات يوضح حالة كل مهارة",
  "تدريب تكيفي يبدأ بأكبر فواقدك",
  "إعادة قياس تثبت إتقان المهارة",
  "اختبار محاكٍ بتوقيت حقيقي",
  "مراجعة أخطائك مع الشرح",
] as const;
