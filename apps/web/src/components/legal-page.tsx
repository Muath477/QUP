import Link from "next/link";

import { type LegalDocument, SUPPORT_EMAIL, SUPPORT_PHONE } from "@/lib/legal-content";

const OTHER_DOCUMENT = {
  privacy: { href: "/terms", label: "الشروط والأحكام" },
  terms: { href: "/privacy", label: "سياسة الخصوصية" },
} as const;

export function LegalPage({
  document,
  kind,
}: {
  document: LegalDocument;
  kind: keyof typeof OTHER_DOCUMENT;
}) {
  const other = OTHER_DOCUMENT[kind];
  return (
    <main id="main-content" className="page page--narrow legal">
      <header className="legal__header">
        <p className="eyebrow">وثائق المنصة</p>
        <h1>{document.title}</h1>
        {document.intro ? <p className="legal__intro">{document.intro}</p> : null}
      </header>

      <ol className="legal__sections">
        {document.sections.map((section) => (
          <li key={section.title} className="legal__section">
            <h2>{section.title}</h2>
            {section.points.length > 1 ? (
              <ul>
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : (
              <p>{section.points[0]}</p>
            )}
          </li>
        ))}
      </ol>

      <section className="legal__contact" aria-labelledby="legal-contact">
        <h2 id="legal-contact">التواصل</h2>
        <p>{document.contactLead}</p>
        <ul>
          <li>
            البريد الإلكتروني:{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} dir="ltr">
              {SUPPORT_EMAIL}
            </a>
          </li>
          <li>
            رقم التواصل:{" "}
            <a href={`tel:${SUPPORT_PHONE}`} dir="ltr">
              {SUPPORT_PHONE}
            </a>
          </li>
        </ul>
      </section>

      <p className="legal__closing">{document.closing}</p>
      <p className="small muted">
        اقرأ أيضًا: <Link href={other.href}>{other.label}</Link>
      </p>
    </main>
  );
}
