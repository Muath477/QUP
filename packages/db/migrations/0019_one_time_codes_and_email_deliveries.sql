-- 0019 one_time_codes_and_email_deliveries
-- Review: additive only — two new tables, no existing table or row is touched.
--   * one_time_codes: email OTP for verifying an address and resetting a password. Only an HMAC of
--     the code is stored. A partial unique index allows one live code per user and purpose.
--   * email_deliveries: what was sent to whom and its delivery status (support log, webhook target).
--     idempotency_key is unique: it is also the provider's Idempotency-Key, so one logical email is
--     sent once. The qup_set_updated_at trigger (0001) keeps updated_at honest.
-- Rollback: DROP TABLE one_time_codes; DROP TABLE email_deliveries;
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"to_address" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_status_known" CHECK ("email_deliveries"."status" IN ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED')),
	CONSTRAINT "email_deliveries_attempts_non_negative" CHECK ("email_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "one_time_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_time_codes_purpose_known" CHECK ("one_time_codes"."purpose" IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET')),
	CONSTRAINT "one_time_codes_attempts_non_negative" CHECK ("one_time_codes"."failed_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_codes" ADD CONSTRAINT "one_time_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_idempotency_key_unique" ON "email_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_deliveries_provider_message_idx" ON "email_deliveries" USING btree ("provider","provider_message_id") WHERE provider_message_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_deliveries_user_created_idx" ON "email_deliveries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_status_created_idx" ON "email_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_time_codes_one_live" ON "one_time_codes" USING btree ("user_id","purpose") WHERE consumed_at IS NULL;--> statement-breakpoint
CREATE INDEX "one_time_codes_user_purpose_created_idx" ON "one_time_codes" USING btree ("user_id","purpose","created_at");
--> statement-breakpoint
CREATE TRIGGER email_deliveries_set_updated_at BEFORE UPDATE ON email_deliveries FOR EACH ROW EXECUTE FUNCTION qup_set_updated_at();
