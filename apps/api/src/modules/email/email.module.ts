import { Module } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../../config/app-config.js";
import { EmailService } from "./application/email.service.js";
import { EmailWebhookService } from "./application/email-webhook.service.js";
import { EMAIL_DELIVERY_STORE, EMAIL_SENDER, type EmailSender } from "./domain/ports.js";
import { TRANSACTIONAL_EMAIL } from "./email.contract.js";
import { DrizzleEmailDeliveryStore } from "./infrastructure/drizzle-email-delivery-store.js";
import { SndrEmailSender } from "./infrastructure/sndr/sndr-email-sender.js";
import { EmailWebhooksController } from "./presentation/email-webhooks.controller.js";

/**
 * Transactional email: one place that knows how to send, log and track a
 * message. Other modules depend on the contract (email.contract.ts), never on
 * SNDR. With no SNDR credentials the sender is null: no email can be sent,
 * everything else works (like payments without Stream).
 */
@Module({
  controllers: [EmailWebhooksController],
  providers: [
    EmailService,
    EmailWebhookService,
    { provide: TRANSACTIONAL_EMAIL, useExisting: EmailService },
    { provide: EMAIL_DELIVERY_STORE, useClass: DrizzleEmailDeliveryStore },
    {
      provide: EMAIL_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailSender | null =>
        config.email.sndr ? new SndrEmailSender(config.email.sndr) : null,
    },
  ],
  exports: [TRANSACTIONAL_EMAIL],
})
export class EmailModule {}
