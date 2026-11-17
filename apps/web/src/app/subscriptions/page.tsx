"use client";

import { PageHeading } from "@/components/page-heading";
import { PaymentHistory } from "@/components/payment-history";
import { PlanCatalog } from "@/components/plan-offers";
import { ErrorNotice } from "@/components/status";
import { useCurrentUser, useRequireUser } from "@/lib/session";

export default function SubscriptionsPage() {
  const user = useRequireUser();
  const identity = useCurrentUser();
  return (
    <main id="main-content" className="page stack stack--loose">
      <PageHeading
        title="الباقات"
        description="اختر باقة اختبار واحد، أو الباقة الشاملة لكل الاختبارات. كل باقة تفتح التشخيص الكامل وملف المهارات والتدريب التكيفي وإعادة القياس في اختباراتها. السعر والمدة كما تظهر هنا تمامًا."
      />
      {identity.isError ? <ErrorNotice error={identity.error} /> : null}
      {user ? (
        <>
          <PlanCatalog />
          <section className="card stack" aria-labelledby="payments-heading">
            <h2 id="payments-heading">سجل المدفوعات</h2>
            <PaymentHistory />
          </section>
        </>
      ) : null}
    </main>
  );
}
