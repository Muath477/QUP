import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { LEGAL_DOCUMENTS } from "@/lib/legal";

const document = LEGAL_DOCUMENTS.refund;

export const metadata: Metadata = {
  title: document.title,
  description: document.summary,
};

export default function RefundPage() {
  return <LegalPage document={document} />;
}
