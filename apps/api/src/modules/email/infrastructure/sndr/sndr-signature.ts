import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * SNDR webhook signatures (sndr.sh/docs/webhooks):
 *
 *   X-Sndr-Signature: t=<unix time>,v1=<hex HMAC-SHA256>[,v1s=<hex>]
 *   signed message  = "<t>.<raw request body>"
 *
 * `v1s` appears while a replacement secret is staged (key rotation): either
 * signature may verify. The body must be the exact bytes received. SNDR asks
 * receivers to reject a `t` more than five minutes old, which stops replays.
 */

const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const UNIX_TIMESTAMP = /^\d{1,15}$/;
const MS_PER_SECOND = 1_000;
export const SIGNATURE_TOLERANCE_SECONDS = 300;

interface ParsedHeader {
  timestamp: number;
  signatures: Buffer[];
}

function parseHeader(header: string): ParsedHeader | null {
  let timestamp: string | null = null;
  const signatures: Buffer[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) return null;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    else if (key.startsWith("v1") && HEX_SHA256.test(value)) {
      signatures.push(Buffer.from(value, "hex"));
    }
  }
  if (timestamp === null || !UNIX_TIMESTAMP.test(timestamp) || signatures.length === 0) {
    return null;
  }
  return { timestamp: Number(timestamp), signatures };
}

export function isValidSndrSignature(
  secret: string,
  rawBody: Buffer,
  header: string | undefined,
  now: Date,
): boolean {
  if (!header) return false;
  const parsed = parseHeader(header);
  if (!parsed) return false;
  const ageSeconds = Math.abs(now.getTime() / MS_PER_SECOND - parsed.timestamp);
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.`)
    .update(rawBody)
    .digest();
  // Lengths are equal by construction (64 hex chars), which timingSafeEqual requires.
  return parsed.signatures.some(
    (signature) => signature.length === expected.length && timingSafeEqual(signature, expected),
  );
}

/** For tests and local tooling: the header SNDR would send for this body. */
export function signSndrPayload(secret: string, rawBody: Buffer, timestamp: number): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}
