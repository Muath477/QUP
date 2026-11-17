"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { PageHeading } from "@/components/page-heading";
import { ResendButton } from "@/components/resend-code";
import { ErrorNotice, Loading } from "@/components/status";
import { TextField } from "@/components/text-field";
import { confirmEmail, requestEmailVerification } from "@/lib/api";
import { type CodeForm, type CodeFormInput, codeForm } from "@/lib/auth-forms";
import { retryAfterSeconds, useResendCountdown } from "@/lib/resend-countdown";
import { ME_QUERY_KEY, useMe, useRequireUser } from "@/lib/session";

/**
 * Verifying an email address with a mailed code. Verification does not gate
 * anything (OPEN_QUESTIONS.md #6): it lets the student recover the account if
 * the password is forgotten. Asking for the code is an explicit button, never
 * a side effect of opening the page.
 */
export default function VerifyEmailPage() {
  const user = useRequireUser();
  const me = useMe();
  const queryClient = useQueryClient();
  const [sent, setSent] = useState(false);
  const countdown = useResendCountdown();
  const form = useForm<CodeFormInput, unknown, CodeForm>({
    resolver: zodResolver(codeForm),
    defaultValues: { code: "" },
  });

  const request = useMutation({
    mutationFn: requestEmailVerification,
    onSuccess: (answer) => {
      setSent(true);
      countdown.start(answer.resendAfterSeconds);
    },
    onError: (error) => {
      // Asked again too soon: a code is already on its way, so show the entry form.
      const wait = retryAfterSeconds(error);
      if (wait !== null) {
        setSent(true);
        countdown.start(wait);
      }
    },
  });
  const confirm = useMutation({
    mutationFn: (values: CodeForm) => confirmEmail(values.code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });

  const features = me.data?.features;
  return (
    <main id="main-content" className="page page--focused stack stack--loose">
      <PageHeading
        title="توثيق البريد الإلكتروني"
        description="نرسل رمزًا من ٦ أرقام إلى بريدك لنتأكد أنه بريدك، فتستطيع استعادة حسابك إذا نسيت كلمة المرور."
      />
      {me.isPending ? <Loading /> : null}
      {me.isError ? <ErrorNotice error={me.error} /> : null}
      {user && !user.email ? (
        <p className="notice" role="status">
          حسابك مسجّل برقم الجوال فقط. لإضافة بريد إلكتروني تواصل مع الدعم.
        </p>
      ) : null}
      {user?.email && user.emailVerified ? (
        <div className="notice notice--success" role="status">
          <strong>بريدك الإلكتروني موثّق.</strong>
          <p>
            <bdi dir="ltr">{user.email}</bdi> مرتبط بحسابك، وتستطيع استعادة الحساب به.{" "}
            <Link href="/dashboard">العودة إلى مساحتك</Link>
          </p>
        </div>
      ) : null}
      {user?.email && !user.emailVerified && features && !features.emailCodes ? (
        <p className="notice" role="status">
          إرسال الرموز غير متاح حاليًا. سنفعّله قريبًا؛ لا يؤثر هذا على استخدامك للمنصة.
        </p>
      ) : null}

      {user?.email && !user.emailVerified && features?.emailCodes ? (
        <section className="card stack" aria-labelledby="code-heading">
          <h2 id="code-heading">رمز التوثيق</h2>
          {!sent ? (
            <>
              <p>
                سنرسل الرمز إلى <bdi dir="ltr">{user.email}</bdi>.
              </p>
              {request.isError && retryAfterSeconds(request.error) === null ? (
                <ErrorNotice error={request.error} />
              ) : null}
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  disabled={request.isPending}
                  onClick={() => request.mutate()}
                >
                  {request.isPending ? "جارٍ الإرسال…" : "أرسل لي الرمز"}
                </button>
              </div>
            </>
          ) : (
            <form
              className="stack"
              noValidate
              method="post"
              onSubmit={form.handleSubmit((values) => confirm.mutate(values))}
            >
              <p role="status">
                أرسلنا رمزًا إلى <bdi dir="ltr">{user.email}</bdi>. يصلك خلال دقيقة عادةً، وصلاحيته ١٠
                دقائق. تحقق من البريد غير الهام إن لم تجده.
              </p>
              {confirm.isError ? <ErrorNotice error={confirm.error} /> : null}
              {request.isError && retryAfterSeconds(request.error) === null ? (
                <ErrorNotice error={request.error} />
              ) : null}
              <TextField
                idPrefix="verify"
                label="الرمز"
                registration={form.register("code")}
                error={form.formState.errors.code?.message}
                autoComplete="one-time-code"
                inputMode="numeric"
                inputClassName="code-input"
                ltr
              />
              <div className="row">
                <button type="submit" className="btn" disabled={confirm.isPending}>
                  {confirm.isPending ? "جارٍ التحقق…" : "وثّق بريدي"}
                </button>
                <ResendButton
                  seconds={countdown.seconds}
                  pending={request.isPending}
                  onResend={() => request.mutate()}
                />
              </div>
            </form>
          )}
        </section>
      ) : null}
    </main>
  );
}
