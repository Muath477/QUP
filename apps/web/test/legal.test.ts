import { describe, expect, it } from "vitest";
import {
  LEGAL_CONTACT,
  LEGAL_DOCUMENTS,
  LEGAL_SLUGS,
  LEGAL_UPDATED_AT,
  REFUND_WINDOW_HOURS,
} from "../src/lib/legal";

describe("legal documents", () => {
  it("lists every document once, each under its own slug", () => {
    expect(new Set(LEGAL_SLUGS).size).toBe(LEGAL_SLUGS.length);
    for (const slug of LEGAL_SLUGS) expect(LEGAL_DOCUMENTS[slug].slug).toBe(slug);
    expect(Object.keys(LEGAL_DOCUMENTS).sort()).toEqual([...LEGAL_SLUGS].sort());
  });

  it.each(LEGAL_SLUGS)(
    "gives %s unique anchors that do not collide with the contact section",
    (slug) => {
      const ids = LEGAL_DOCUMENTS[slug].sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain("contact");
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
    },
  );

  it("links only to documents that exist", () => {
    const links = LEGAL_SLUGS.flatMap((slug) =>
      LEGAL_DOCUMENTS[slug].sections.flatMap((section) =>
        section.blocks.flatMap((block) => (block.kind === "link" ? [block.href] : [])),
      ),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) expect(LEGAL_SLUGS).toContain(href.slice(1));
  });

  it("states the same refund window in the terms and the refund policy", () => {
    const window = `${REFUND_WINDOW_HOURS} ساعة`;
    const text = (slug: "terms" | "refund") => JSON.stringify(LEGAL_DOCUMENTS[slug]);
    expect(text("terms")).toContain(window);
    expect(text("refund")).toContain(window);
  });

  it("carries a valid last-updated date and reachable contact details", () => {
    expect(Number.isNaN(Date.parse(LEGAL_UPDATED_AT))).toBe(false);
    expect(LEGAL_CONTACT.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(LEGAL_CONTACT.phoneInternational).toBe(`+966${LEGAL_CONTACT.phone.slice(1)}`);
  });
});
