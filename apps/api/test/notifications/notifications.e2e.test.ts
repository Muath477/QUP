import { randomUUID } from "node:crypto";

import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/config/app-config.js";
import { OutboxEventType } from "../../src/infrastructure/outbox/outbox.js";
import { OutboxRelay } from "../../src/infrastructure/outbox/outbox-relay.js";
import { WorkerModule } from "../../src/worker/worker.module.js";
import {
  deleteE2eUsers,
  E2E_DATABASE_URL,
  e2eEmail,
  e2eExamCode,
  e2ePhone,
  e2eSql,
  purgeE2eCatalog,
} from "../support/e2e-database.js";
import {
  FAKE_OTP_SECRET,
  FAKE_SNDR_API_KEY,
  FAKE_SNDR_FROM,
  type FakeSndr,
  startFakeSndr,
} from "../support/fake-sndr.js";
import { LogCapture, testConfig } from "../support/test-app.js";

/**
 * The worker's side of notifications: "an email is owed" events become sent
 * emails, retried when the provider is down, once however often they run.
 * Real database and relay; SNDR is a local stand-in.
 */

const PRICE = 19_900;
let sndr: FakeSndr;
let sending: INestApplicationContext;
let notSending: INestApplicationContext;
let relay: OutboxRelay;
let relayWithoutEmail: OutboxRelay;

function worker(config: AppConfig): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(
    WorkerModule.forRoot(config, { logDestination: new LogCapture() }),
    { logger: false },
  );
}

async function user(label: string, identity: "email" | "phone" = "email") {
  const email = identity === "email" ? e2eEmail(label) : null;
  const [row] = await e2eSql<{ id: string }[]>`
    INSERT INTO users (email, phone, password_hash)
    VALUES (${email}, ${identity === "phone" ? e2ePhone() : null}, 'not-a-real-hash')
    RETURNING id`;
  if (!row) throw new Error("user insert returned no row");
  return { id: row.id, email: email ?? "" };
}

/** A payment of a plan, in the given status, as billing would have left it. */
async function payment(
  studentId: string,
  status: "SUCCEEDED" | "REFUNDED",
  planName = "باقة القدرات",
) {
  const [exam] = await e2eSql<{ id: string }[]>`
    INSERT INTO exams (code, slug, name_ar, status)
    VALUES (${e2eExamCode()}, ${`e2e-n-${randomUUID().slice(0, 8)}`}, 'اختبار', 'ACTIVE')
    RETURNING id`;
  const [plan] = await e2eSql<{ id: string }[]>`
    INSERT INTO plans (code, name, price_minor, currency, duration_days, status)
    VALUES (${`E2E-N-${randomUUID().slice(0, 8).toUpperCase()}`}, ${planName}, ${PRICE}, 'SAR', 90, 'ACTIVE')
    RETURNING id`;
  await e2eSql`INSERT INTO plan_exams (plan_id, exam_id) VALUES (${plan?.id ?? null}, ${exam?.id ?? null})`;
  const [row] = await e2eSql<{ id: string }[]>`
    INSERT INTO payments (student_id, plan_id, provider, amount_minor, currency, idempotency_key,
                          status, paid_at, terms)
    VALUES (${studentId}, ${plan?.id ?? null}, 'stream', ${PRICE}, 'SAR', ${randomUUID()}, ${status}::payment_status,
            now(), ${e2eSql.json({ planName, durationDays: 90, examIds: [exam?.id ?? ""] })})
    RETURNING id`;
  if (!row) throw new Error("payment insert returned no row");
  return row.id;
}

async function owe(payload: Record<string, string>): Promise<string> {
  const [row] = await e2eSql<{ id: string }[]>`
    INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES ('notification-test', ${randomUUID()}, ${OutboxEventType.EmailRequested}, ${e2eSql.json(payload)})
    RETURNING id`;
  if (!row) throw new Error("outbox insert returned no row");
  return row.id;
}

const eventOf = async (id: string) =>
  (
    await e2eSql<{ status: string; attempts: number }[]>`
      SELECT status, attempts FROM outbox_events WHERE id = ${id}`
  )[0];

const deliveriesOf = (userId: string) =>
  e2eSql<{ kind: string; status: string; attempts: number; last_error: string | null }[]>`
    SELECT kind, status, attempts, last_error FROM email_deliveries WHERE user_id = ${userId} ORDER BY created_at`;

/** A retry is not due for seconds; the tests do not wait for them. */
const makeDue = () => e2eSql`
  UPDATE outbox_events SET available_at = now() WHERE aggregate_type = 'notification-test' AND status = 'PENDING'`;

beforeAll(async () => {
  await purgeE2eCatalog();
  await deleteE2eUsers();
  sndr = await startFakeSndr();
  const base = { DATABASE_URL: E2E_DATABASE_URL };
  sending = await worker(
    testConfig({
      ...base,
      SNDR_API_KEY: FAKE_SNDR_API_KEY,
      SNDR_FROM: FAKE_SNDR_FROM,
      SNDR_API_BASE_URL: sndr.baseUrl,
      OTP_SECRET: FAKE_OTP_SECRET,
      APP_PUBLIC_URL: "https://qupedu.com",
    }),
  );
  notSending = await worker(testConfig(base));
  relay = sending.get(OutboxRelay);
  relayWithoutEmail = notSending.get(OutboxRelay);
});

afterAll(async () => {
  await e2eSql`DELETE FROM outbox_events WHERE aggregate_type = 'notification-test'`;
  await sending.close();
  await notSending.close();
  await sndr.close();
  await purgeE2eCatalog();
  await deleteE2eUsers();
  await e2eSql.end();
});

describe("payment receipt", () => {
  it("mails the student what they paid for, once, and publishes the event", async () => {
    const student = await user("receipt");
    const paymentId = await payment(student.id, "SUCCEEDED", "باقة التحصيلي");
    const event = await owe({ kind: "PAYMENT_RECEIPT", userId: student.id, paymentId });

    await relay.drain();

    const mails = sndr.to(student.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.body.subject).toBe("تأكيد الدفع — باقة التحصيلي");
    expect(mails[0]?.body.text).toContain("https://qupedu.com/dashboard");
    expect(mails[0]?.idempotencyKey).toBe(`receipt:${paymentId}`);
    expect(await eventOf(event)).toMatchObject({ status: "PUBLISHED" });
    expect(await deliveriesOf(student.id)).toEqual([
      { kind: "PAYMENT_RECEIPT", status: "SENT", attempts: 1, last_error: null },
    ]);

    // The same payment announced again (a duplicate event) mails nothing new.
    await owe({ kind: "PAYMENT_RECEIPT", userId: student.id, paymentId });
    await relay.drain();
    expect(sndr.to(student.email)).toHaveLength(1);
  });

  it("sends no receipt for a payment that has since been refunded, or is not the student's", async () => {
    const student = await user("receipt-refunded");
    const refunded = await payment(student.id, "REFUNDED");
    await owe({ kind: "PAYMENT_RECEIPT", userId: student.id, paymentId: refunded });

    const other = await user("receipt-other");
    const theirs = await payment(student.id, "SUCCEEDED");
    await owe({ kind: "PAYMENT_RECEIPT", userId: other.id, paymentId: theirs });

    await relay.drain();
    expect(sndr.to(student.email)).toHaveLength(0);
    expect(sndr.to(other.email)).toHaveLength(0);
  });
});

describe("refund notice", () => {
  it("tells the student their money is on its way back", async () => {
    const student = await user("refund");
    const paymentId = await payment(student.id, "REFUNDED", "باقة STEP");
    await owe({ kind: "PAYMENT_REFUNDED", userId: student.id, paymentId });

    await relay.drain();

    const [mail] = sndr.to(student.email);
    expect(mail?.body.subject).toBe("تم استرجاع المبلغ — باقة STEP");
    expect(await deliveriesOf(student.id)).toMatchObject([
      { kind: "PAYMENT_REFUNDED", status: "SENT" },
    ]);
  });
});

describe("password changed notice", () => {
  it("mails the account's address", async () => {
    const student = await user("password");
    await owe({ kind: "PASSWORD_CHANGED", userId: student.id });
    await relay.drain();
    const [mail] = sndr.to(student.email);
    expect(mail?.body.subject).toBe("تم تغيير كلمة مرور حسابك");
    expect(mail?.body.html).toContain("https://qupedu.com/forgot-password");
  });
});

describe("when the provider is down", () => {
  it("keeps the event, retries it later, and sends the email exactly once", async () => {
    const student = await user("outage");
    const paymentId = await payment(student.id, "SUCCEEDED");
    const event = await owe({ kind: "PAYMENT_RECEIPT", userId: student.id, paymentId });
    sndr.failNext(503);

    await relay.drain();

    expect(sndr.to(student.email)).toHaveLength(0);
    expect(await eventOf(event)).toEqual({ status: "PENDING", attempts: 1 });
    expect(await deliveriesOf(student.id)).toMatchObject([{ status: "QUEUED", attempts: 1 }]);
    expect((await deliveriesOf(student.id))[0]?.last_error).toContain("503");

    // Not due yet: another drain leaves it alone.
    await relay.drain();
    expect(await eventOf(event)).toEqual({ status: "PENDING", attempts: 1 });

    await makeDue();
    await relay.drain();
    expect(sndr.to(student.email)).toHaveLength(1);
    expect(await eventOf(event)).toMatchObject({ status: "PUBLISHED" });
    expect(await deliveriesOf(student.id)).toMatchObject([{ status: "SENT", attempts: 2 }]);
  });

  it("retries a send whose answer was lost without mailing twice (idempotency key)", async () => {
    const student = await user("lost-answer");
    const paymentId = await payment(student.id, "SUCCEEDED");
    const event = await owe({ kind: "PAYMENT_RECEIPT", userId: student.id, paymentId });
    // SNDR accepts the message, then the connection drops before we hear so.
    sndr.loseNextAnswer();

    await relay.drain();
    expect(sndr.to(student.email)).toHaveLength(1);
    expect(await eventOf(event)).toEqual({ status: "PENDING", attempts: 1 });

    await makeDue();
    await relay.drain();

    // The retry carried the same Idempotency-Key, so SNDR sent nothing new.
    expect(sndr.to(student.email)).toHaveLength(1);
    expect(await eventOf(event)).toMatchObject({ status: "PUBLISHED" });
    const [delivery] = await deliveriesOf(student.id);
    expect(delivery).toMatchObject({ status: "SENT", attempts: 2 });
  });

  it("gives up on an email the provider rejects, without retrying it", async () => {
    const student = await user("rejected");
    const paymentId = await payment(student.id, "SUCCEEDED");
    const event = await owe({ kind: "PAYMENT_RECEIPT", userId: student.id, paymentId });
    const before = sndr.calls;
    sndr.failNext(422, "suppressed");

    await relay.drain();

    expect(sndr.calls - before).toBe(1);
    expect(await eventOf(event)).toMatchObject({ status: "PUBLISHED", attempts: 0 });
    const [delivery] = await deliveriesOf(student.id);
    expect(delivery).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(delivery?.last_error).toContain("suppressed");
  });

  it("fails the event for good after the relay's attempts run out, for a person to look at", async () => {
    const student = await user("long-outage");
    const paymentId = await payment(student.id, "SUCCEEDED");
    const event = await owe({ kind: "PAYMENT_RECEIPT", userId: student.id, paymentId });
    sndr.failNext(503, "provider_error", 8);

    for (let i = 0; i < 8; i += 1) {
      await makeDue();
      await relay.drain();
    }

    expect(await eventOf(event)).toEqual({ status: "FAILED", attempts: 8 });
    expect(sndr.to(student.email)).toHaveLength(0);
  });
});

describe("what is not mailed", () => {
  it("skips an account with no email address, and a malformed request, without failing", async () => {
    const phoneOnly = await user("phone", "phone");
    const skipped = await owe({ kind: "PASSWORD_CHANGED", userId: phoneOnly.id });
    const malformed = await owe({ kind: "PAYMENT_RECEIPT", userId: "not-a-uuid" });
    const unknownKind = await owe({ kind: "SOMETHING_ELSE", userId: phoneOnly.id });

    await relay.drain();

    for (const id of [skipped, malformed, unknownKind]) {
      expect(await eventOf(id)).toMatchObject({ status: "PUBLISHED", attempts: 0 });
    }
    expect(await deliveriesOf(phoneOnly.id)).toEqual([]);
  });

  it("skips quietly, and does not pile up failures, while email is not configured", async () => {
    const student = await user("unconfigured");
    const event = await owe({ kind: "PASSWORD_CHANGED", userId: student.id });

    await relayWithoutEmail.drain();

    expect(await eventOf(event)).toMatchObject({ status: "PUBLISHED", attempts: 0 });
    expect(await deliveriesOf(student.id)).toEqual([]);
    expect(sndr.to(student.email)).toHaveLength(0);
  });
});
