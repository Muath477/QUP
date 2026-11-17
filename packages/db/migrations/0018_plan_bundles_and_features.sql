-- 0018 plan_bundles_and_features
-- Review: additive, plus one relaxation, with a backfill. No row is deleted or rewritten.
--   * plan_exams: the exams a plan covers, so one plan can cover several (the all-exams
--     bundle). Backfilled from plans.exam_id: every existing plan keeps exactly its exam.
--   * plans.exam_id becomes nullable and is no longer written. It stays, filled for every
--     existing plan, so this migration can be rolled back; a later migration drops it.
--   * plans: description, features, highlighted, sort_order, compare_at_price_minor —
--     what the pricing page shows. Defaults make every existing plan valid as it is.
--   * payments.terms: what the payment bought (plan name, duration, exams), frozen at
--     checkout. Backfilled for existing payments from their plan as it is now, which is
--     what they bought: offered plans could not be edited before this migration.
--   * payments_created_at_idx: the admin ledger and student history, newest first.
--   * The entitlement replay guard becomes unique per (source, reference, exam): one bundle
--     payment grants one entitlement per exam. Every pair the old index allowed is still
--     unique under the new one, so the new index cannot fail on existing rows. It is
--     created before the old one is dropped, so no write lands between two guards.
-- Rollback (only while no plan covers more than one exam):
--   UPDATE plans p SET exam_id = pe.exam_id FROM plan_exams pe WHERE pe.plan_id = p.id;
--   ALTER TABLE plans ALTER COLUMN exam_id SET NOT NULL;
--   CREATE UNIQUE INDEX entitlements_source_reference_unique ON entitlements (source, source_reference)
--     WHERE source_reference IS NOT NULL;
--   DROP INDEX entitlements_source_reference_exam_unique; DROP INDEX payments_created_at_idx;
--   DROP TABLE plan_exams; ALTER TABLE payments DROP COLUMN terms;
--   ALTER TABLE plans DROP COLUMN description, DROP COLUMN features, DROP COLUMN highlighted,
--     DROP COLUMN sort_order, DROP COLUMN compare_at_price_minor;
CREATE TABLE "plan_exams" (
	"plan_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	CONSTRAINT "plan_exams_plan_id_exam_id_pk" PRIMARY KEY("plan_id","exam_id")
);
--> statement-breakpoint
ALTER TABLE "plan_exams" ADD CONSTRAINT "plan_exams_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_exams" ADD CONSTRAINT "plan_exams_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_exams_exam_idx" ON "plan_exams" USING btree ("exam_id");--> statement-breakpoint
INSERT INTO "plan_exams" ("plan_id", "exam_id") SELECT "id", "exam_id" FROM "plans" WHERE "exam_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "exam_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "features" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "highlighted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "compare_at_price_minor" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_compare_at_above_price" CHECK ("plans"."compare_at_price_minor" IS NULL OR "plans"."compare_at_price_minor" > "plans"."price_minor");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_features_array" CHECK (jsonb_typeof("plans"."features") = 'array');--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "terms" jsonb;--> statement-breakpoint
UPDATE "payments" AS "pay" SET "terms" = jsonb_build_object('planName', "p"."name", 'durationDays', "p"."duration_days", 'examIds', jsonb_build_array("p"."exam_id")) FROM "plans" AS "p" WHERE "p"."id" = "pay"."plan_id" AND "pay"."terms" IS NULL;--> statement-breakpoint
CREATE INDEX "payments_created_at_idx" ON "payments" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_source_reference_exam_unique" ON "entitlements" USING btree ("source","source_reference","exam_id") WHERE source_reference IS NOT NULL;--> statement-breakpoint
DROP INDEX "entitlements_source_reference_unique";
