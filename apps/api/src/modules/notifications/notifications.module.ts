import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { EmailModule } from "../email/email.module.js";
import { EmailNotificationHandler } from "./application/email-notification.handler.js";

/**
 * The worker's notification side: handles "an email is owed" outbox events by
 * writing and sending the email (EmailNotificationHandler). Lives apart from
 * EmailModule so that auth can depend on sending without depending on its
 * own consumers (this module reads accounts and payments; email reads neither).
 */
@Module({
  imports: [EmailModule, AuthModule, BillingModule],
  providers: [EmailNotificationHandler],
  exports: [EmailNotificationHandler],
})
export class NotificationsModule {}
