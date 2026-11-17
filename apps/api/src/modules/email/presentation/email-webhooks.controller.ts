import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  type RawBodyRequest,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ZodValidationPipe } from "../../../common/validation/zod-validation.pipe.js";
import {
  AUTH_THROTTLER,
  GLOBAL_THROTTLER,
} from "../../../infrastructure/rate-limit/rate-limit.module.js";
import { Public } from "../../auth/presentation/public.decorator.js";
import { EmailWebhookService } from "../application/email-webhook.service.js";
import { EmailWebhookPayloadInvalid } from "../domain/email.errors.js";

const providerName = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "must be a provider name");

/**
 * Email provider webhooks, the counterpart of payments/webhooks.
 *
 * @Public: the provider has no session. The request is authenticated by its
 * signature instead, checked over the exact bytes received. Not rate limited:
 * deliveries come from the provider, and a throttled one is retried much later.
 */
@ApiExcludeController()
@Public()
@SkipThrottle({ [GLOBAL_THROTTLER]: true, [AUTH_THROTTLER]: true })
@Controller("email/webhooks")
export class EmailWebhooksController {
  constructor(private readonly webhooks: EmailWebhookService) {}

  @Post(":provider")
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param("provider", new ZodValidationPipe(providerName)) provider: string,
    @Req() request: RawBodyRequest<FastifyRequest>,
  ) {
    if (!request.rawBody) throw new EmailWebhookPayloadInvalid();
    await this.webhooks.handle(provider, request.rawBody, singleHeaders(request.headers));
    return { received: true };
  }
}

/** A header sent more than once is ambiguous; the first value is used. */
function singleHeaders(headers: FastifyRequest["headers"]): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, Array.isArray(value) ? value[0] : value]),
  );
}
