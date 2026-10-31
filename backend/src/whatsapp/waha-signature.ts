import { createHmac, timingSafeEqual } from 'crypto';

/** Verify only the bytes authenticated by WAHA; transport metadata is unsigned. */
export function verifyWahaSignature(
  rawBody: Buffer | undefined,
  key: string | undefined,
  signature: unknown,
  algorithm: unknown,
): boolean {
  if (
    !Buffer.isBuffer(rawBody) ||
    !key ||
    algorithm !== 'sha512' ||
    typeof signature !== 'string' ||
    !/^[0-9a-f]{128}$/.test(signature)
  ) {
    return false;
  }

  const expected = createHmac('sha512', key).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/**
 * Derive the webhook key handed to one WAHA session from a single deployment
 * secret. Each session gets a distinct 256-bit key, so a leaked per-session key
 * cannot forge another session's events and cannot be reversed into the master.
 * Returns null when the master is absent, letting the caller fail closed.
 */
export function deriveWebhookKey(
  masterKey: string | undefined,
  sessionName: string | undefined,
): string | null {
  if (!masterKey || !sessionName) return null;
  return createHmac('sha256', masterKey)
    .update(`waha:webhook:${sessionName}`)
    .digest('hex');
}
