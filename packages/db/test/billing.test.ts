import { afterAll, describe, it } from "vitest";

import {
  expectRejected,
  firstRow,
  SqlState,
  type Tx,
  testSql,
  withRollback,
} from "./support/db.js";
import { insertUser } from "./support/fixtures.js";

afterAll(() => testSql.end());

type IdRow = { id: string };

async function buildPlan(tx: Tx): Promise<{ studentId: string; examId: string; planId: string }> {
  const student = { id: await insertUser(tx, "test-buyer") };
  const exam = firstRow(
    await tx<IdRow[]>`
      INSERT INTO exams (code, slug, name_ar) VALUES ('TEST-B', 'test-b', 'اختبار') RETURNING id`,
  );
  const plan = firstRow(
    await tx<IdRow[]>`
      INSERT INTO plans (code, name, price_minor, currency)
      VALUES ('TEST-PLAN', 'plan', 1000, 'SAR') RETURNING id`,
  );
  await tx`INSERT INTO plan_exams (plan_id, exam_id) VALUES (${plan.id}, ${exam.id})`;
  return { studentId: student.id, examId: exam.id, planId: plan.id };
}

// DOMAIN_MODEL.md §3 — "نفس payment event لا يمنح entitlement مرتين" / "webhook replay لا يكرر grant".
describe("billing replay protection", () => {
  it("rejects a second payment with the same idempotency key", () =>
    withRollback(async (tx) => {
      const { studentId, planId } = await buildPlan(tx);
      const pay = (db: Tx) => db`
        INSERT INTO payments (student_id, plan_id, provider, amount_minor, currency, idempotency_key)
        VALUES (${studentId}, ${planId}, 'test-provider', 1000, 'SAR', 'checkout-1')`;
      await pay(tx);

      await expectRejected(tx, SqlState.uniqueViolation, (sp) => pay(sp));
    }));

  it("grants at most one entitlement per payment reference", () =>
    withRollback(async (tx) => {
      const { studentId, examId, planId } = await buildPlan(tx);
      const grant = (db: Tx) => db`
        INSERT INTO entitlements (student_id, plan_id, exam_id, source, source_reference, starts_at)
        VALUES (${studentId}, ${planId}, ${examId}, 'PAYMENT', 'payment-123', now())`;
      await grant(tx);

      await expectRejected(tx, SqlState.uniqueViolation, (sp) => grant(sp));
    }));

  it("lets one bundle payment grant one entitlement per exam, and no more", () =>
    withRollback(async (tx) => {
      const { studentId, examId, planId } = await buildPlan(tx);
      const second = firstRow(
        await tx<IdRow[]>`
          INSERT INTO exams (code, slug, name_ar) VALUES ('TEST-B2', 'test-b2', 'اختبار ٢') RETURNING id`,
      );
      const grant = (db: Tx, exam: string) => db`
        INSERT INTO entitlements (student_id, plan_id, exam_id, source, source_reference, starts_at)
        VALUES (${studentId}, ${planId}, ${exam}, 'PAYMENT', 'bundle-payment', now())`;
      await grant(tx, examId);
      await grant(tx, second.id);

      await expectRejected(tx, SqlState.uniqueViolation, (sp) => grant(sp, second.id));
    }));

  it("stores money as a non-negative amount in an ISO 4217 currency", () =>
    withRollback(async (tx) => {
      await buildPlan(tx);

      await expectRejected(
        tx,
        SqlState.checkViolation,
        (sp) => sp`
          INSERT INTO plans (code, name, price_minor, currency) VALUES ('NEG', 'n', -1, 'SAR')`,
      );
      await expectRejected(
        tx,
        SqlState.checkViolation,
        (sp) => sp`
          INSERT INTO plans (code, name, price_minor, currency) VALUES ('CUR', 'c', 100, 'riyal')`,
      );
    }));

  it("keeps the 'was' price above the price, and features a list", () =>
    withRollback(async (tx) => {
      await expectRejected(
        tx,
        SqlState.checkViolation,
        (sp) => sp`
          INSERT INTO plans (code, name, price_minor, compare_at_price_minor, currency)
          VALUES ('CMP', 'c', 1000, 1000, 'SAR')`,
      );
      await expectRejected(
        tx,
        SqlState.checkViolation,
        (sp) => sp`
          INSERT INTO plans (code, name, price_minor, currency, features)
          VALUES ('FEAT', 'f', 1000, 'SAR', ${sp.json({ not: "a list" })})`,
      );
    }));
});
