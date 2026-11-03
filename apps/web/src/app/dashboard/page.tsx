"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { AssessmentHistory, SESSION_STATUS_LABELS } from "@/components/assessment-history";
import {
  ExamTabs,
  FocusPanels,
  NextStepPanel,
  SkillMap,
  StandingSummary,
  StartPanel,
} from "@/components/dashboard-overview";
import { ErrorNotice, Loading } from "@/components/status";
import {
  getDashboard,
  isApiError,
  listAssessmentHistory,
  listExams,
  type SessionStatus,
} from "@/lib/api";
import { firstName } from "@/lib/dashboard-view";
import { useCurrentUser, useRequireUser } from "@/lib/session";

const PAGE_SIZE = 10;

export default function DashboardPage() {
  const user = useRequireUser();
  const identity = useCurrentUser();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<SessionStatus | "">("");
  const [chosenExamId, setChosenExamId] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["assessment-history", user?.id, status, offset],
    queryFn: () =>
      listAssessmentHistory({ limit: PAGE_SIZE, offset, ...(status ? { status } : {}) }),
    enabled: user !== null,
  });
  const dashboard = useQuery({
    queryKey: ["dashboard", user?.id],
    queryFn: getDashboard,
    enabled: user !== null,
  });

  const exams = dashboard.data?.exams ?? [];
  const selected = exams.find((item) => item.exam.id === chosenExamId) ?? exams[0];
  const isNewStudent = dashboard.isSuccess && !selected;
  // A first visit with a single exam goes straight to its free diagnostic.
  const catalog = useQuery({ queryKey: ["exams"], queryFn: listExams, enabled: isNewStudent });
  const onlyExam = catalog.data?.items.length === 1 ? catalog.data.items[0] : undefined;
  const name = firstName(user?.displayName);

  return (
    <main id="main-content" className="page page--wide dash">
      <header className="dash-head">
        <div>
          <p className="dash-head__exam">{selected ? selected.exam.nameAr : "مساحتك في QUP"}</p>
          <h1>{name ? `مرحبًا، ${name}` : "مرحبًا بك"}</h1>
        </div>
        {selected ? (
          <ExamTabs
            exams={exams}
            selectedId={selected.exam.id}
            onSelect={(examId) => setChosenExamId(examId)}
          />
        ) : null}
      </header>

      {dashboard.isPending && user ? <Loading /> : null}
      {dashboard.isError ? <ErrorNotice error={dashboard.error} /> : null}

      {selected ? <NextStepPanel progress={selected} /> : null}
      {isNewStudent ? (
        <StartPanel diagnosticHref={onlyExam ? `/exams/${onlyExam.id}/diagnostic` : "/exams"} />
      ) : null}

      {selected?.standing ? (
        <>
          <StandingSummary progress={selected} />
          <div className="dash-grid">
            <SkillMap examId={selected.exam.id} />
            <FocusPanels progress={selected} />
          </div>
        </>
      ) : null}

      {isNewStudent ? null : (
        <section className="history-panel" aria-labelledby="history-heading">
          <div className="history-toolbar">
            <h2 id="history-heading">جلساتك</h2>
            <div className="history-filter">
              <label htmlFor="session-status">حالة الجلسة</label>
              <select
                id="session-status"
                className="field__input"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as SessionStatus | "");
                  setOffset(0);
                }}
              >
                <option value="">كل الجلسات</option>
                {Object.entries(SESSION_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {identity.isError ? <ErrorNotice error={identity.error} /> : null}
          {!identity.isError && history.isPending ? <Loading /> : null}
          {history.isError ? (
            <ErrorNotice error={history.error}>
              {isApiError(history.error, "UNAUTHENTICATED") ? (
                <Link href="/login">تسجيل الدخول مجددًا</Link>
              ) : (
                <button type="button" className="btn btn--ghost" onClick={() => history.refetch()}>
                  إعادة المحاولة
                </button>
              )}
            </ErrorNotice>
          ) : null}
          {user && !identity.isError && history.isSuccess ? (
            <AssessmentHistory items={history.data.items} />
          ) : null}
          {offset > 0 || history.data?.page.hasMore ? (
            <nav className="pagination" aria-label="صفحات سجل الجلسات">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={offset === 0 || history.isFetching}
                onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
              >
                السابق
              </button>
              <span className="small" aria-live="polite">
                الصفحة {Math.floor(offset / PAGE_SIZE) + 1}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={!history.data?.page.hasMore || history.isFetching || history.isError}
                onClick={() => setOffset((value) => value + PAGE_SIZE)}
              >
                التالي
              </button>
            </nav>
          ) : null}
        </section>
      )}
    </main>
  );
}
