import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { CSSProperties } from "react";
import { type ExamProgress, getSkillProfile, type SkillProfile } from "@/lib/api";
import { coverageShare } from "@/lib/dashboard-view";
import { MASTERY_STATE_LABELS, percentText } from "@/lib/mastery-labels";
import { improvementText, nextStepAction, nextStepLink, nextStepReason } from "@/lib/next-step";
import { Icon } from "./icon";
import { ErrorNotice, Loading } from "./status";

/**
 * The student dashboard's blocks (UI_BRAND.md "Student Dashboard Principle"):
 * where the student stands, strengths, gaps, and one next action. Every
 * figure comes from /me/dashboard or the skill profile; nothing is derived
 * here beyond formatting.
 */

/**
 * The one thing to do next, chosen by the API. Secondary routes sit beside it
 * as quiet links, so the page never offers three buttons to the same place.
 */
export function NextStepPanel({ progress }: { progress: ExamProgress }) {
  const { exam, standing } = progress;
  const next = nextStepLink(progress.nextStep, exam.id);
  return (
    <section className="next-step" aria-labelledby="next-step-title">
      <div className="next-step__copy">
        <p className="next-step__label">خطوتك التالية</p>
        <h2 id="next-step-title">{next.label}</h2>
        <p>{nextStepReason(progress.nextStep)}</p>
      </div>
      <div className="next-step__actions">
        <Link href={next.href} className="btn btn--gold btn--large">
          {nextStepAction(progress.nextStep)} <Icon name="arrow" />
        </Link>
        {standing ? (
          <div className="next-step__links">
            <Link href={`/exams/${exam.id}/mistakes`}>مراجعة أخطائي</Link>
            <Link href={`/exams/${exam.id}/mock-exam`}>اختبار محاكٍ</Link>
          </div>
        ) : (
          <div className="next-step__links">
            <Link href="/subscriptions">الباقات</Link>
          </div>
        )}
      </div>
    </section>
  );
}

/** The first visit: no exam yet, so the only step is the free diagnostic. */
export function StartPanel({ diagnosticHref }: { diagnosticHref: string }) {
  return (
    <section className="next-step" aria-labelledby="next-step-title">
      <div className="next-step__copy">
        <p className="next-step__label">خطوتك الأولى</p>
        <h2 id="next-step-title">ابدأ التشخيص المصغّر المجاني</h2>
        <p>أسئلة قليلة من أقسام الاختبار تعطيك قراءة أولى لمستواك، وتظهر نتيجتها فور إكمالها.</p>
      </div>
      <div className="next-step__actions">
        <Link href={diagnosticHref} className="btn btn--gold btn--large">
          ابدأ التشخيص <Icon name="arrow" />
        </Link>
      </div>
    </section>
  );
}

export function ExamTabs({
  exams,
  selectedId,
  onSelect,
}: {
  exams: ExamProgress[];
  selectedId: string;
  onSelect: (examId: string) => void;
}) {
  if (exams.length < 2) return null;
  return (
    <fieldset className="exam-tabs">
      <legend className="visually-hidden">اختر الاختبار المعروض</legend>
      {exams.map(({ exam }) => (
        <button
          key={exam.id}
          type="button"
          aria-pressed={exam.id === selectedId}
          className="exam-tabs__tab"
          onClick={() => onSelect(exam.id)}
        >
          {exam.nameAr}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * Where the student stands, as four plain counts. The coverage line under the
 * first count is the only graphic: it shows how much of the exam is measured.
 */
export function StandingSummary({ progress }: { progress: ExamProgress }) {
  return progress.standing ? <SkillCounts summary={progress.standing.summary} /> : null;
}

/** The four skill counts, shared by the dashboard and the skill profile. */
export function SkillCounts({ summary }: { summary: SkillProfile["summary"] }) {
  const share = coverageShare(summary);
  return (
    <dl className="stat-row" aria-label="ملخص مهاراتك">
      <div className="stat">
        <dt>مهارات قيست</dt>
        <dd>
          <bdi>{`${summary.assessed} من ${summary.skills}`}</bdi>
        </dd>
        <span className="stat__meter" aria-hidden="true">
          <span style={{ "--share": share } as CSSProperties} />
        </span>
      </div>
      <div className="stat" data-tone="success">
        <dt>متقنة</dt>
        <dd>
          <bdi>{summary.mastered}</bdi>
        </dd>
      </div>
      <div className="stat">
        <dt>جاهزة لإعادة القياس</dt>
        <dd>
          <bdi>{summary.readyForReassessment}</bdi>
        </dd>
      </div>
      <div className="stat" data-tone="danger">
        <dt>فجوات</dt>
        <dd>
          <bdi>{summary.gaps}</bdi>
        </dd>
      </div>
    </dl>
  );
}

/** Each domain's skills with their measured mastery, from the skill profile. */
export function SkillMap({ examId }: { examId: string }) {
  const profile = useQuery({
    queryKey: ["skill-profile", examId],
    queryFn: () => getSkillProfile(examId),
  });
  return (
    <section className="dash-card skill-map" aria-labelledby="skill-map-title">
      <div className="dash-card__head">
        <h2 id="skill-map-title">خريطة مهاراتك</h2>
        <Link href={`/exams/${examId}/profile`} className="text-link">
          الملف الكامل <Icon name="chevron" />
        </Link>
      </div>
      {profile.isPending ? <Loading /> : null}
      {profile.isError ? <ErrorNotice error={profile.error} /> : null}
      {profile.data ? (
        <div className="skill-map__domains">
          {profile.data.domains.map((domain) => (
            <section key={domain.id} className="skill-domain" aria-label={domain.name}>
              <h3>{domain.name}</h3>
              <ul>
                {domain.skills.map((skill) => (
                  <li key={skill.id}>
                    <div className="skill-domain__row">
                      <span>{skill.name}</span>
                      <bdi>{skill.mastery === null ? "—" : percentText(skill.mastery)}</bdi>
                    </div>
                    <span className="profile-bar" aria-hidden="true">
                      <span style={{ "--share": skill.mastery ?? 0 } as CSSProperties} />
                    </span>
                    <span className={`mastery-badge mastery-badge--${skill.state.toLowerCase()}`}>
                      {MASTERY_STATE_LABELS[skill.state]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function FocusPanels({ progress }: { progress: ExamProgress }) {
  const { standing } = progress;
  if (!standing) return null;
  return (
    <div className="focus-panels">
      <section className="dash-card" aria-labelledby="gaps-title">
        <h2 id="gaps-title" className="dash-card__title">
          أولويات التدريب
        </h2>
        {standing.gaps.length ? (
          <ol className="rank-list rank-list--gaps">
            {standing.gaps.map((gap, index) => (
              <li key={gap.skillName}>
                <span className="rank-list__index">{index + 1}</span>
                <span>{gap.skillName}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="small muted">لا فجوات مقيسة الآن.</p>
        )}
      </section>
      <section className="dash-card" aria-labelledby="strengths-title">
        <h2 id="strengths-title" className="dash-card__title">
          نقاط قوتك
        </h2>
        {standing.strengths.length ? (
          <ul className="rank-list">
            {standing.strengths.map((strength) => (
              <li key={strength.skillName}>
                <Icon name="check" />
                <span>{strength.skillName}</span>
                <bdi className="small">
                  {strength.state === "MASTERED"
                    ? MASTERY_STATE_LABELS.MASTERED
                    : percentText(strength.mastery)}
                </bdi>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">
            لا مهارة تجاوزت حد القوة بعد. تظهر هنا حين ترتفع نسبتك في مهارة وتثبت.
          </p>
        )}
      </section>
      {standing.improvements.length ? (
        <section className="dash-card" aria-labelledby="improvements-title">
          <h2 id="improvements-title" className="dash-card__title">
            تقدّمك هذا الأسبوع
          </h2>
          <ul className="rank-list">
            {standing.improvements.map((change) => (
              <li key={change.nodeName}>
                <span>{change.nodeName}</span>
                <bdi className="small rank-list__gain">
                  {improvementText(change.before, change.after)}
                </bdi>
                <bdi className="small muted">
                  {`${percentText(change.before)} ← ${percentText(change.after)}`}
                </bdi>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
