import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { privacyPolicy } from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "سياسة الخصوصية | QUP",
  description: "ما البيانات التي تجمعها QUP، وكيف تستخدمها وتحميها، وما حقوقك فيها.",
};

export default function PrivacyPage() {
  return <LegalPage document={privacyPolicy} kind="privacy" />;
}
