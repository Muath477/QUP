import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { termsAndConditions } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "الشروط والأحكام | QUP",
  description: "شروط استخدام منصة QUP والاشتراك فيها، وسياسة الاسترجاع.",
};

export default function TermsPage() {
  return <LegalPage document={termsAndConditions} kind="terms" />;
}
