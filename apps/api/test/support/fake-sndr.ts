import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { signSndrPayload } from "../../src/modules/email/infrastructure/sndr/sndr-signature.js";

/**
 * A stand-in for SNDR's API, on 127.0.0.1. It speaks the shapes of SNDR's
 * published API for `POST /v1/send` (202 `{ id, status }`, errors as
 * `{ error: { code, message } }`), honours Idempotency-Key as documented, and
 * records what it was sent. Nothing leaves the machine; no SNDR account is used.
 */

export const FAKE_SNDR_API_KEY = "sndr_live_fake_key_for_tests";
export const FAKE_SNDR_WEBHOOK_SECRET = "fake-sndr-webhook-secret";
export const FAKE_SNDR_FROM = "QUP <no-reply@mail.qup.test>";
export const FAKE_OTP_SECRET = "fake-otp-secret-0123456789abcdef-0123456789";

export interface SentEmail {
  id: string;
  idempotencyKey: string | undefined;
  authorization: string | undefined;
  body: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
    reply_to?: string;
  };
}

export interface FakeSndr {
  baseUrl: string;
  /** Distinct emails accepted so far, oldest first. A replayed Idempotency-Key is not added again. */
  sent: SentEmail[];
  /** Every call to /v1/send, including rejected and replayed ones. */
  calls: number;
  /** The next `times` sends answer with this status (and error code). */
  failNext(status: number, code?: string, times?: number): void;
  /** The next send never answers (until the client gives up). */
  hangNext(): void;
  /** The next send is accepted and recorded, but the connection drops before the answer arrives. */
  loseNextAnswer(): void;
  /** Mail sent to an address, newest last. */
  to(address: string): SentEmail[];
  /** The six-digit code in the newest mail to an address. */
  latestCode(address: string): string;
  close(): Promise<void>;
}

async function readJson(request: IncomingMessage): Promise<SentEmail["body"] | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as SentEmail["body"];
}

export async function startFakeSndr(): Promise<FakeSndr> {
  const sent: SentEmail[] = [];
  const byKey = new Map<string, SentEmail>();
  const failures: { status: number; code: string }[] = [];
  let calls = 0;
  let hang = false;
  let loseAnswer = false;

  const server: Server = createServer((request, response) => {
    void (async () => {
      const send = (status: number, payload: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      if (request.method !== "POST" || request.url !== "/v1/send") {
        return send(404, { error: { code: "not_found", message: "no such route" } });
      }
      calls += 1;
      const body = await readJson(request);
      if (hang) {
        hang = false;
        return; // never answers
      }
      const failure = failures.shift();
      if (failure) {
        return send(failure.status, { error: { code: failure.code, message: "simulated" } });
      }
      if (request.headers.authorization !== `Bearer ${FAKE_SNDR_API_KEY}`) {
        return send(401, { error: { code: "unauthenticated", message: "bad key" } });
      }
      if (!body) return send(400, { error: { code: "invalid_request", message: "no body" } });

      const key = request.headers["idempotency-key"];
      const idempotencyKey = Array.isArray(key) ? key[0] : key;
      const replay = idempotencyKey ? byKey.get(idempotencyKey) : undefined;
      if (replay) return send(202, { id: replay.id, status: "queued" });

      const email: SentEmail = {
        id: `eml_${randomUUID().slice(0, 12)}`,
        idempotencyKey,
        authorization: request.headers.authorization,
        body,
      };
      sent.push(email);
      if (idempotencyKey) byKey.set(idempotencyKey, email);
      if (loseAnswer) {
        loseAnswer = false;
        request.socket.destroy();
        return;
      }
      return send(202, { id: email.id, from: body.from, to: body.to, status: "queued" });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const fake: FakeSndr = {
    baseUrl: `http://127.0.0.1:${port}`,
    sent,
    get calls() {
      return calls;
    },
    failNext: (status, code = "provider_error", times = 1) => {
      for (let i = 0; i < times; i += 1) failures.push({ status, code });
    },
    hangNext: () => {
      hang = true;
    },
    loseNextAnswer: () => {
      loseAnswer = true;
    },
    to: (address) => sent.filter((email) => email.body.to.includes(address)),
    latestCode: (address) => {
      const mail = sent.filter((email) => email.body.to.includes(address)).at(-1);
      const code = mail?.body.text.match(/^\d{6}$/m)?.[0];
      if (!code) throw new Error(`no code mailed to ${address}`);
      return code;
    },
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
  return fake;
}

/** A webhook delivery as SNDR sends it: the exact body bytes and their signature header. */
export function sndrWebhook(
  event: { type: string; emailId: string; createdAt?: Date; reason?: string },
  options: { secret?: string; at?: Date } = {},
): { payload: string; headers: Record<string, string> } {
  const payload = JSON.stringify({
    id: `evt_${randomUUID().slice(0, 12)}`,
    type: event.type,
    created_at: (event.createdAt ?? new Date()).toISOString(),
    data: {
      email_id: event.emailId,
      to: ["someone@example.com"],
      ...(event.reason ? { reason: event.reason } : {}),
    },
  });
  const seconds = Math.floor((options.at ?? new Date()).getTime() / 1000);
  return {
    payload,
    headers: {
      "content-type": "application/json",
      "x-sndr-signature": signSndrPayload(
        options.secret ?? FAKE_SNDR_WEBHOOK_SECRET,
        Buffer.from(payload),
        seconds,
      ),
    },
  };
}
