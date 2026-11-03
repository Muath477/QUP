import type { CSSProperties } from "react";
import type { SkillProfile } from "@/lib/api";
import { skillStateSegments } from "@/lib/dashboard-view";
import { CountUp } from "./count-up";

/**
 * One cell per skill, grouped by state, with a legend that carries the counts.
 * Colour is never alone: each state is named beside its count, and the strip
 * has a text alternative.
 */
export function SkillCounts({ summary }: { summary: SkillProfile["summary"] }) {
  const segments = skillStateSegments(summary);
  const described = segments
    .filter((segment) => segment.count > 0)
    .map((segment) => `${segment.count} ${segment.label}`)
    .join("، ");
  let cell = 0;
  return (
    <section className="state-strip" aria-labelledby="state-strip-title">
      <h2 id="state-strip-title" className="state-strip__title">
        <span className="state-strip__big">
          <CountUp value={summary.assessed} />
        </span>
        <span>{`من ${summary.skills} مهارات قيست حتى الآن`}</span>
      </h2>
      <div className="state-strip__bar" role="img" aria-label={described}>
        {segments.flatMap((segment) =>
          Array.from({ length: segment.count }, (_, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: cells of one state are interchangeable
              key={`${segment.key}-${index}`}
              className="state-strip__cell"
              data-state={segment.key}
              title={segment.label}
              style={{ "--i": cell++ } as CSSProperties}
            />
          )),
        )}
      </div>
      <ul className="state-strip__legend">
        {segments.map((segment) => (
          <li
            key={segment.key}
            data-state={segment.key}
            data-empty={segment.count === 0 || undefined}
          >
            <span className="state-strip__swatch" aria-hidden="true" />
            <strong>
              <CountUp value={segment.count} />
            </strong>
            <span>{segment.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
