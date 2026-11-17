// Rendered only inside client pages, so no "use client" entry of its own.

/** "Send a new code", disabled — and counting down — until the API would accept one. */
export function ResendButton({
  seconds,
  pending,
  onResend,
}: {
  seconds: number;
  pending: boolean;
  onResend: () => void;
}) {
  const waiting = seconds > 0;
  return (
    <button
      type="button"
      className="btn btn--ghost btn--small"
      disabled={waiting || pending}
      onClick={onResend}
    >
      {pending
        ? "جارٍ الإرسال…"
        : waiting
          ? `أرسل رمزًا جديدًا بعد ${seconds} ثانية`
          : "أرسل رمزًا جديدًا"}
    </button>
  );
}
