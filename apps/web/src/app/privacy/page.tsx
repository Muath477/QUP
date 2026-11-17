import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { LEGAL_DOCUMENTS } from "@/lib/legal";

const document = LEGAL_DOCUMENTS.privacy;

export const metadata: Metadata = {
  title: document.title,
  description: document.summary,
};

export default function PrivacyPage() {
  return <LegalPage document={document} />;
}
