"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { listPlanCatalog } from "@/lib/api";
import { durationText } from "@/lib/billing-form";
import { formatPrice } from "@/lib/messages";
import { Icon } from "./icon";

/** How many features a landing card lists; the rest are on the pricing page. */
const PREVIEW_FEATURES = 4;

/**
 * The plans on sale, on the landing page. Prices come from the API exactly as
 * checkout will charge them. With nothing on sale — or the API unreachable —
 * the section is simply absent: the landing page never shows an error or a
 * made-up price.
 */
export function PricingPreview() {
  const plans = useQuery({ queryKey: ["public-plan-catalog"], queryFn: listPlanCatalog });
  const items = plans.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="home-pricing" id="pricing" aria-labelledby="pricing-title">
      <div className="home-section-head">
        <p className="eyebrow">الباقات</p>
        <h2 id="pricing-title">ادفع مرة واحدة، وتدرّب على ما تحتاجه فقط.</h2>
        <p className="muted">
          ابدأ بالتشخيص المصغّر المجاني، ثم اختر باقة اختبارك أو الباقة الشاملة. بلا تجديد تلقائي.
        </p>
      </div>
      <ul className="plan-grid">
        {items.map((plan) => (
          <li
            key={plan.id}
            className={`plan-card${plan.highlighted ? " plan-card--highlighted" : ""}`}
          >
            {plan.highlighted ? <span className="plan-card__ribbon">الأكثر اختيارًا</span> : null}
            <div className="plan-card__head">
              <h3>{plan.name}</h3>
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
                : `لمدة ${durationText(plan.durationDays)}`}
            </p>
            {plan.features.length > 0 ? (
              <ul className="plan-card__features">
                {plan.features.slice(0, PREVIEW_FEATURES).map((feature) => (
                  <li key={feature}>
                    <Icon name="check" />
                    {feature}
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href="/register" className={`btn${plan.highlighted ? "" : " btn--ghost"}`}>
              ابدأ مجانًا ثم اشترك <Icon name="arrow" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
