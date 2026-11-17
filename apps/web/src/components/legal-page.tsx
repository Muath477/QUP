import Link from "next/link";
import { formatDate } from "@/lib/format";
import {
  LEGAL_CONTACT,
  LEGAL_DOCUMENTS,
  LEGAL_SLUGS,
  LEGAL_UPDATED_AT,
  type LegalBlock,
  type LegalDocument,
  type LegalListItem,
} from "@/lib/legal";
import { Icon } from "./icon";

/** Terms, privacy and refunds share one reading layout, so they read as one set. */
export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main id="main-content" className="legal">
      <header className="legal-hero">
        <div className="legal-hero__inner">
          <p className="eyebrow eyebrow--on-dark">المركز القانوني</p>
          <h1>{document.title}</h1>
          <p className="legal-hero__summary">{document.summary}</p>
          <p className="legal-hero__meta">
            آخر تحديث: <time dateTime={LEGAL_UPDATED_AT}>{formatDate(LEGAL_UPDATED_AT)}</time>
          </p>
          <nav className="legal-tabs" aria-label="الوثائق القانونية">
            {LEGAL_SLUGS.map((slug) => (
              <Link
                key={slug}
                href={`/${slug}`}
                aria-current={slug === document.slug ? "page" : undefined}
              >
                {LEGAL_DOCUMENTS[slug].title}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="legal-body">
        <aside className="legal-toc">
          <nav aria-label="محتويات الصفحة">
            <p className="legal-toc__title">المحتويات</p>
            <ol>
              {document.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
              <li>
                <a href="#contact">التواصل</a>
              </li>
            </ol>
          </nav>
        </aside>

        <article className="legal-article">
          <p className="legal-intro">{document.intro}</p>

          {document.highlights ? (
            <dl className="legal-highlights">
              {document.highlights.map((highlight) => (
                <div key={highlight.value}>
                  <dt>{highlight.label}</dt>
                  <dd>{highlight.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {document.sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              className="legal-section"
              aria-labelledby={`${section.id}-title`}
            >
              <h2 id={`${section.id}-title`}>
                <span className="legal-section__number" aria-hidden="true">
                  {index + 1}
                </span>
                {section.title}
              </h2>
              {section.blocks.map((block, blockIndex) => (
                // Blocks are fixed content in a fixed order; their position is their identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: static, never reordered
                <LegalBlockView key={blockIndex} block={block} />
              ))}
            </section>
          ))}

          <section id="contact" className="legal-contact" aria-labelledby="contact-title">
            <h2 id="contact-title">التواصل</h2>
            <p>{document.contactPrompt}</p>
            <ul>
              <li>
                <span>البريد الإلكتروني</span>
                <a href={`mailto:${LEGAL_CONTACT.email}`} dir="ltr">
                  {LEGAL_CONTACT.email}
                </a>
              </li>
              <li>
                <span>رقم التواصل</span>
                <a href={`tel:${LEGAL_CONTACT.phoneInternational}`} dir="ltr">
                  {LEGAL_CONTACT.phone}
                </a>
              </li>
            </ul>
          </section>

          {document.acknowledgement ? (
            <p className="legal-acknowledgement">{document.acknowledgement}</p>
          ) : null}
        </article>
      </div>
    </main>
  );
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case "paragraph":
      return <p>{block.text}</p>;
    case "note":
      return <p className="legal-note">{block.text}</p>;
    case "list":
      return (
        <ul className="legal-list">
          {block.items.map((item) => (
            <li key={listItemKey(item)}>
              {typeof item === "string" ? (
                item
              ) : (
                <>
                  <strong>{item.term}:</strong> {item.text}
                </>
              )}
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="legal-steps">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case "link":
      return (
        <p className="legal-see-also">
          {block.text}{" "}
          <Link href={block.href}>
            {block.label}
            <Icon name="arrow" />
          </Link>
        </p>
      );
  }
}

function listItemKey(item: LegalListItem): string {
  return typeof item === "string" ? item : item.term;
}
