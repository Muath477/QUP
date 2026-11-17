import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InvalidConfigError, loadConfig } from "../../src/config/app-config.js";
import {
  decideGuess,
  decideIssue,
  hashCode,
  hashesEqual,
  normalizeCode,
  OTP_POLICY,
} from "../../src/modules/auth/domain/otp-policy.js";
import {
  canApplyProviderStatus,
  statusFromSndrEvent,
} from "../../src/modules/email/domain/delivery-status.js";
import {
  deliveryKind,
  escapeHtml,
  formatMoney,
  renderEmail,
} from "../../src/modules/email/domain/email-templates.js";
import { EmailSendFailed } from "../../src/modules/email/domain/ports.js";
import {
  isRetryableStatus,
  SndrEmailSender,
} from "../../src/modules/email/infrastructure/sndr/sndr-email-sender.js";
import {
  isValidSndrSignature,
  signSndrPayload,
} from "../../src/modules/email/infrastructure/sndr/sndr-signature.js";
import {
  FAKE_SNDR_API_KEY,
  FAKE_SNDR_FROM,
  type FakeSndr,
  startFakeSndr,
} from "../support/fake-sndr.js";

const NOW = new Date("2026-11-17T12:00:00Z");
const at = (secondsFromNow: number) => new Date(NOW.getTime() + secondsFromNow * 1000);

describe("one-time code policy", () => {
  it.each([
    ["123456", "123456"],
    [" 123 456 ", "123456"],
    ["١٢٣٤٥٦", "123456"],
    ["۱۲۳۴۵۶", "123456"],
    ["123-456", "123456"],
    ["12345", null],
    ["1234567", null],
    ["12345a", null],
    ["", null],
  ])("reads %j as %j", (typed, code) => {
    expect(normalizeCode(typed)).toBe(code);
  });

  it("hashes a code per purpose and address, so it cannot be spent elsewhere", () => {
    const base = hashCode("secret", "PASSWORD_RESET", "a@x.com", "123456");
    expect(hashesEqual(base, hashCode("secret", "PASSWORD_RESET", "a@x.com", "123456"))).toBe(true);
    for (const other of [
      hashCode("secret", "EMAIL_VERIFICATION", "a@x.com", "123456"),
      hashCode("secret", "PASSWORD_RESET", "b@x.com", "123456"),
      hashCode("secret", "PASSWORD_RESET", "a@x.com", "123457"),
      hashCode("another-secret", "PASSWORD_RESET", "a@x.com", "123456"),
    ]) {
      expect(hashesEqual(base, other)).toBe(false);
    }
    expect(base).not.toContain("123456");
  });

  it("allows a new code only after the cooldown and under the hourly limit", () => {
    const allowed = decideIssue({ now: NOW, previousIssuedAt: null, issuedInLastHour: 0 });
    expect(allowed).toEqual({ kind: "ALLOWED" });
    expect(decideIssue({ now: NOW, previousIssuedAt: at(-61), issuedInLastHour: 1 })).toEqual({
      kind: "ALLOWED",
    });
    expect(decideIssue({ now: NOW, previousIssuedAt: at(-20), issuedInLastHour: 1 })).toEqual({
      kind: "TOO_SOON",
      retryAfterSeconds: 40,
    });
    expect(
      decideIssue({
        now: NOW,
        previousIssuedAt: at(-3000),
        issuedInLastHour: OTP_POLICY.maxPerHour,
      }),
    ).toEqual({ kind: "HOURLY_LIMIT" });
  });

  it("burns a code after five wrong guesses or once it expires, and accepts the right one before", () => {
    const live = { now: NOW, expiresAt: at(300), failedAttempts: 0, correct: false };
    expect(decideGuess({ ...live, correct: true })).toBe("ACCEPT");
    expect(decideGuess(live)).toBe("REJECT");
    expect(decideGuess({ ...live, failedAttempts: 3 })).toBe("REJECT");
    expect(decideGuess({ ...live, failedAttempts: 4 })).toBe("REJECT_AND_BURN");
    // Even the right code, too late.
    expect(decideGuess({ ...live, expiresAt: at(-1), correct: true })).toBe("REJECT_AND_BURN");
    expect(decideGuess({ ...live, expiresAt: NOW, correct: true })).toBe("REJECT_AND_BURN");
  });
});

describe("email templates", () => {
  it("writes a code email whose subject never contains the code", () => {
    for (const purpose of ["EMAIL_VERIFICATION", "PASSWORD_RESET"] as const) {
      const mail = renderEmail({ kind: "OTP", purpose, code: "483920", validForMinutes: 10 });
      expect(mail.subject).not.toContain("483920");
      expect(mail.html).toContain("483920");
      expect(mail.text.split("\n")).toContain("483920");
      expect(mail.html).toContain('dir="rtl"');
      expect(mail.html).toContain("10 دقائق");
    }
    expect(
      renderEmail({ kind: "OTP", purpose: "PASSWORD_RESET", code: "1", validForMinutes: 10 })
        .subject,
    ).toBe("رمز استعادة كلمة المرور");
  });

  it("escapes everything an admin or a stranger can type", () => {
    const evil = `<img src=x onerror="alert(1)"> & 'q'`;
    const mail = renderEmail({
      kind: "PAYMENT_RECEIPT",
      planName: evil,
      amountMinor: 19_900,
      currency: "SAR",
      paidAt: NOW,
      refundableUntil: at(48 * 3600),
      appUrl: 'https://qup.test/"><script>',
    });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;q&#39;");
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("states a receipt's amount, plan and refund deadline, in Riyadh time", () => {
    const mail = renderEmail({
      kind: "PAYMENT_RECEIPT",
      planName: "باقة القدرات",
      amountMinor: 19_900,
      currency: "SAR",
      paidAt: new Date("2026-11-17T12:00:00Z"),
      refundableUntil: new Date("2026-11-19T12:00:00Z"),
      appUrl: "https://qupedu.com",
    });
    expect(mail.subject).toBe("تأكيد الدفع — باقة القدرات");
    expect(mail.text).toContain(formatMoney(19_900, "SAR"));
    expect(mail.text).toContain("https://qupedu.com/dashboard");
    // 12:00 UTC is 15:00 in Riyadh.
    expect(mail.text).toMatch(/3:00|٣:٠٠|15:00/);
  });

  it("omits links when the web address is not configured", () => {
    const changed = renderEmail({ kind: "PASSWORD_CHANGED", changedAt: NOW, appUrl: null });
    expect(changed.html).not.toContain("<a ");
    expect(
      deliveryKind({ kind: "OTP", purpose: "PASSWORD_RESET", code: "1", validForMinutes: 1 }),
    ).toBe("OTP_PASSWORD_RESET");
    expect(
      deliveryKind({ kind: "PAYMENT_REFUNDED", planName: "x", amountMinor: 1, currency: "SAR" }),
    ).toBe("PAYMENT_REFUNDED");
  });
});

describe("delivery status", () => {
  it("moves forward only: a final status is never overwritten", () => {
    expect(canApplyProviderStatus("QUEUED", "DELIVERED")).toBe(true);
    expect(canApplyProviderStatus("SENT", "BOUNCED")).toBe(true);
    expect(canApplyProviderStatus("SENT", "FAILED")).toBe(true);
    expect(canApplyProviderStatus("DELIVERED", "BOUNCED")).toBe(false);
    expect(canApplyProviderStatus("BOUNCED", "DELIVERED")).toBe(false);
    expect(canApplyProviderStatus("FAILED", "DELIVERED")).toBe(false);
  });

  it("reads SNDR's event names", () => {
    expect(statusFromSndrEvent("email.delivered")).toBe("DELIVERED");
    expect(statusFromSndrEvent("email.bounced")).toBe("BOUNCED");
    expect(statusFromSndrEvent("email.failed")).toBe("FAILED");
    expect(statusFromSndrEvent("email.unsubscribed")).toBeNull();
  });
});

describe("SNDR webhook signature", () => {
  const SECRET = "whsec_test";
  const BODY = Buffer.from('{"type":"email.delivered"}');
  const T = Math.floor(NOW.getTime() / 1000);
  const header = signSndrPayload(SECRET, BODY, T);

  it("accepts HMAC-SHA256 over '<t>.<raw body>', within five minutes", () => {
    expect(isValidSndrSignature(SECRET, BODY, header, NOW)).toBe(true);
    expect(isValidSndrSignature(SECRET, BODY, header, at(299))).toBe(true);
    expect(isValidSndrSignature(SECRET, BODY, header, at(301))).toBe(false);
    expect(isValidSndrSignature(SECRET, BODY, header, at(-301))).toBe(false);
  });

  it("rejects a body that differs by a byte, another secret or another time", () => {
    expect(
      isValidSndrSignature(SECRET, Buffer.from('{"type":"email.delivered" }'), header, NOW),
    ).toBe(false);
    expect(isValidSndrSignature("other", BODY, header, NOW)).toBe(false);
    const sig = header.split(",v1=")[1];
    expect(isValidSndrSignature(SECRET, BODY, `t=${T + 1},v1=${sig}`, NOW)).toBe(false);
  });

  it("accepts either signature while a replacement secret is staged", () => {
    const staged = signSndrPayload("new-secret", BODY, T).split(",v1=")[1];
    const rotating = `${header},v1s=${staged}`;
    expect(isValidSndrSignature(SECRET, BODY, rotating, NOW)).toBe(true);
    expect(isValidSndrSignature("new-secret", BODY, rotating, NOW)).toBe(true);
    expect(isValidSndrSignature("third", BODY, rotating, NOW)).toBe(false);
  });

  it.each([
    ["a missing header", undefined],
    ["an empty header", ""],
    ["no timestamp", `v1=${"a".repeat(64)}`],
    ["no signature", `t=${T}`],
    ["a truncated signature", `t=${T},v1=abcd`],
    ["a non-numeric timestamp", `t=abc,v1=${"a".repeat(64)}`],
    ["garbage", "not a signature"],
  ])("rejects %s", (_name, bad) => {
    expect(isValidSndrSignature(SECRET, BODY, bad, NOW)).toBe(false);
  });
});

describe("SNDR sender", () => {
  let sndr: FakeSndr;
  let sender: SndrEmailSender;
  const mail = (key: string) => ({
    to: "student@example.com",
    subject: "موضوع",
    html: "<p>مرحبا</p>",
    text: "مرحبا",
    idempotencyKey: key,
  });

  beforeAll(async () => {
    sndr = await startFakeSndr();
    sender = new SndrEmailSender({
      apiKey: FAKE_SNDR_API_KEY,
      from: FAKE_SNDR_FROM,
      replyTo: "support@qup.test",
      baseUrl: sndr.baseUrl,
      timeoutMs: 300,
    });
  });
  afterAll(() => sndr.close());

  it("posts the message with the key, the sender and the idempotency key", async () => {
    const { messageId } = await sender.send(mail("key-1"));
    const sent = sndr.sent.at(-1);
    expect(sent?.id).toBe(messageId);
    expect(sent?.authorization).toBe(`Bearer ${FAKE_SNDR_API_KEY}`);
    expect(sent?.idempotencyKey).toBe("key-1");
    expect(sent?.body).toMatchObject({
      from: FAKE_SNDR_FROM,
      to: ["student@example.com"],
      reply_to: "support@qup.test",
    });
  });

  it("sends a repeated idempotency key once", async () => {
    const first = await sender.send(mail("key-2"));
    const before = sndr.sent.length;
    const second = await sender.send(mail("key-2"));
    expect(second.messageId).toBe(first.messageId);
    expect(sndr.sent).toHaveLength(before);
  });

  it.each([408, 409, 429, 500, 502, 503])("treats %i as worth retrying", async (status) => {
    expect(isRetryableStatus(status)).toBe(true);
    sndr.failNext(status);
    const error = await sender.send(mail(`retry-${status}`)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailSendFailed);
    expect((error as EmailSendFailed).retryable).toBe(true);
    expect((error as EmailSendFailed).status).toBe(status);
  });

  it.each([400, 401, 403, 422])("does not retry %i: repeating cannot fix it", async (status) => {
    sndr.failNext(status, "domain_not_verified");
    const error = await sender.send(mail(`reject-${status}`)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailSendFailed);
    expect((error as EmailSendFailed).retryable).toBe(false);
    expect((error as EmailSendFailed).providerCode).toBe("domain_not_verified");
    expect(String(error)).not.toContain(FAKE_SNDR_API_KEY);
  });

  it("treats a timeout and an unreachable provider as retryable, without echoing the key", async () => {
    sndr.hangNext();
    const slow = await sender.send(mail("slow")).catch((e: unknown) => e);
    expect((slow as EmailSendFailed).retryable).toBe(true);
    expect((slow as EmailSendFailed).status).toBeNull();

    const down = new SndrEmailSender({
      apiKey: FAKE_SNDR_API_KEY,
      from: FAKE_SNDR_FROM,
      replyTo: null,
      baseUrl: "http://127.0.0.1:1",
      timeoutMs: 300,
    });
    const error = await down.send(mail("down")).catch((e: unknown) => e);
    expect((error as EmailSendFailed).retryable).toBe(true);
    expect(String(error)).not.toContain(FAKE_SNDR_API_KEY);
  });
});

describe("email configuration", () => {
  const BASE = { DATABASE_URL: "postgresql://user:pass@db.internal:5432/qup_db" };
  const problems = (env: Record<string, string>): string => {
    try {
      loadConfig({ ...BASE, ...env });
    } catch (error) {
      if (error instanceof InvalidConfigError) return error.problems.join("\n");
      throw error;
    }
    return "";
  };

  it("runs without email when SNDR is not configured", () => {
    expect(loadConfig(BASE).email.sndr).toBeNull();
    expect(loadConfig({ ...BASE, SNDR_API_KEY: "" }).email.sndr).toBeNull();
  });

  it("needs a sender and an OTP key together with the API key", () => {
    expect(problems({ SNDR_API_KEY: "k" })).toContain("SNDR_FROM");
    expect(problems({ SNDR_API_KEY: "k", SNDR_FROM: "a@b.co" })).toContain("OTP_SECRET");
    expect(problems({ OTP_SECRET: "short" })).toContain("at least 32");
    const ok = { SNDR_API_KEY: "k", SNDR_FROM: "a@b.co", OTP_SECRET: "x".repeat(32) };
    expect(problems(ok)).toBe("");
    expect(loadConfig({ ...BASE, ...ok }).email.sndr?.baseUrl).toBe("https://api.sndr.sh");
  });

  it("never echoes the key and insists on https in production", () => {
    expect(problems({ SNDR_API_KEY: "sk-very-secret" })).not.toContain("sk-very-secret");
    const prod = {
      NODE_ENV: "production",
      PROXY_SHARED_SECRET: "a-proxy-secret-that-is-long-enough-1234",
      SNDR_API_BASE_URL: "http://api.sndr.sh",
    };
    expect(problems(prod)).toContain("SNDR_API_BASE_URL: must use https");
  });
});
