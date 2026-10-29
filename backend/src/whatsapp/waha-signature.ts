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
