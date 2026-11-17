"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icon";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice, Loading } from "@/components/status";
import { isApiError } from "@/lib/api";
import { useRequireUser } from "@/lib/session";
import {
  CHAT_MESSAGE_MAX,
  type ChatMessage,
  clearChat,
  getAiFeatures,
  getChat,
  sendChatMessage,
} from "@/lib/tutor-api";

/** Questions a student can start from when the chat is empty. */
const STARTERS = [
  "كيف أذاكر هذا الاختبار في أسبوعين؟",
  "اشرح لي طريقة حل أسئلة التناظر اللفظي.",
  "كيف أدير وقتي داخل الاختبار؟",
];

export default function AssistantPage() {
  const { examId } = useParams<{ examId: string }>();
  const user = useRequireUser();
  const features = useQuery({
    queryKey: ["ai-features", user?.id, examId],
    queryFn: () => getAiFeatures(examId),
    enabled: user !== null,
    retry: false,
  });

  if (features.isPending) {
    return (
      <main id="main-content" className="page">
        <Loading />
      </main>
    );
  }
  if (features.isError) {
    return (
      <main id="main-content" className="page">
        <ErrorNotice error={features.error} />
      </main>
    );
  }
  if (!features.data.studyChat) {
    return (
      <main id="main-content" className="page">
        <EmptyState
          icon="chat"
          title="المساعد الدراسي غير متاح حاليًا"
          description="نعمل على تشغيله قريبًا. تابع تدريبك وراجع أخطاءك في الأثناء."
        >
          <Link href={`/exams/${examId}/training`} className="btn">
            التدريب <Icon name="arrow" />
          </Link>
        </EmptyState>
      </main>
    );
  }
  if (!features.data.subscribed) return <SubscribeFirst />;
  return <Chat examId={examId} userId={user?.id ?? ""} />;
}

function SubscribeFirst() {
  return (
    <main id="main-content" className="page">
      <EmptyState
        icon="lock"
        title="المساعد الدراسي للمشتركين"
        description="بعد الاشتراك تسأل المساعد عن أي مهارة في الاختبار، فيشرح لك خطوة بخطوة ويقترح عليك ما تتدرّب عليه."
      >
        <Link href="/subscriptions" className="btn">
          عرض الباقات
        </Link>
      </EmptyState>
    </main>
  );
}

/**
 * The study chat (AI_INTEGRATION.md "Study Chat"): one conversation per
 * exam, kept by the server. The assistant only helps with preparing for the
 * exam; what it says is AI-written and may be wrong.
 */
function Chat({ examId, userId }: { examId: string; userId: string }) {
  const id = useId();
  const queryClient = useQueryClient();
  const queryKey = ["ai-chat", userId, examId];
  const [draft, setDraft] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);

  const history = useQuery({ queryKey, queryFn: () => getChat(examId), retry: false });
  const send = useMutation({
    mutationFn: (message: string) => sendChatMessage(examId, message),
    onSuccess: (reply) => {
      setDraft("");
      setSources(reply.sources);
      queryClient.setQueryData<{ items: ChatMessage[] }>(queryKey, (current) => ({
        items: [...(current?.items ?? []), ...reply.messages],
      }));
    },
  });
  const clear = useMutation({
    mutationFn: () => clearChat(examId),
    onSuccess: () => {
      setSources([]);
      queryClient.setQueryData(queryKey, { items: [] });
    },
  });

  const messages = history.data?.items ?? [];
  const count = messages.length;
  useEffect(() => {
    if (count > 0) end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (isApiError(history.error, "AI_REQUIRES_SUBSCRIPTION")) return <SubscribeFirst />;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
    if (message !== "" && !send.isPending) send.mutate(message);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line, as in most chat apps.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <main id="main-content" className="page stack stack--loose">
      <PageHeading
        title="المساعد الدراسي"
        description="اسأل عن مهارات الاختبار وطرق الحل وتنظيم المذاكرة. يجيب فقط عمّا يخص الاستعداد لهذا الاختبار."
        action={
          <Link href={`/exams/${examId}/profile`} className="text-link">
            ملف مهاراتي <Icon name="chevron" />
          </Link>
        }
      />

      <section className="card chat" aria-label="المحادثة">
        {history.isPending ? <Loading /> : null}
        {history.isError ? <ErrorNotice error={history.error} /> : null}
        {history.data && messages.length === 0 ? (
          <div className="chat__empty stack">
            <p className="muted">ابدأ بسؤال، أو اختر واحدًا من هذه:</p>
            <div className="chip-group">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="chip"
                  disabled={send.isPending}
                  onClick={() => send.mutate(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <ol className="chat__log" aria-live="polite" aria-busy={send.isPending}>
          {messages.map((message) => (
            <li
              key={message.id}
              className={`chat__message chat__message--${message.role === "STUDENT" ? "student" : "assistant"}`}
            >
              <span className="visually-hidden">
                {message.role === "STUDENT" ? "أنت:" : "المساعد:"}
              </span>
              <p>{message.content}</p>
            </li>
          ))}
          {send.isPending ? (
            <li className="chat__message chat__message--assistant chat__message--pending">
              <p>يكتب المساعد…</p>
            </li>
          ) : null}
        </ol>
        <div ref={end} />
        {sources.length > 0 ? (
          <p className="small muted">{`استند الرد إلى: ${sources.join("، ")}`}</p>
        ) : null}

        <form className="chat__composer stack" onSubmit={submit}>
          <label className="visually-hidden" htmlFor={`${id}-message`}>
            رسالتك
          </label>
          <textarea
            id={`${id}-message`}
            className="field__input"
            rows={3}
            maxLength={CHAT_MESSAGE_MAX}
            placeholder="اكتب سؤالك… (Enter للإرسال، Shift+Enter لسطر جديد)"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {send.isError ? <ErrorNotice error={send.error} /> : null}
          <div className="row chat__actions">
            <button type="submit" className="btn" disabled={draft.trim() === "" || send.isPending}>
              <Icon name="chat" />
              {send.isPending ? "جارٍ الإرسال…" : "أرسل"}
            </button>
            {messages.length > 0 ? (
              <ConfirmAction
                label="محادثة جديدة"
                description="ستُحذف هذه المحادثة نهائيًا. لا يعيد ذلك رصيدك اليومي من الرسائل."
                confirmLabel="احذفها"
                onConfirm={() => clear.mutate()}
                pending={clear.isPending}
              />
            ) : null}
          </div>
        </form>
        <p className="small muted">
          ردود المساعد مولّدة بالذكاء الاصطناعي وقد تخطئ أحيانًا؛ اعتبرها أداة مساعدة لا مرجعًا وحيدًا.
        </p>
      </section>
    </main>
  );
}
