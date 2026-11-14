import type { INestApplication } from '@nestjs/common';

/**
 * Reverse-proxy trust for the API process (spec S4.2).
 *
 * The API runs behind exactly one edge proxy (the frontend calls the absolute
 * origin https://meperpos-api.up.railway.app, and Railway terminates the
 * connection in front of this process). Express must therefore trust a NUMBER
 * of hops, never `true` and never a wildcard: with a wildcard, any client could
 * set `X-Forwarded-For` itself and choose its own rate-limit bucket and its own
 * audit-log address. The number is the whole point — see
 * `proxy-trust.int.spec.ts` for the forged-left-most-entry assertion.
 *
 * TRUST_PROXY_HOPS: unset -> DEFAULT_TRUST_PROXY_HOPS; "0"/"false" -> trust
 * nothing (use this if the process is ever exposed directly, with no proxy in
 * front); otherwise an integer between 1 and MAX_TRUST_PROXY_HOPS.
 */
export const DEFAULT_TRUST_PROXY_HOPS = 1;

/** A hop count above this is a configuration mistake, not a topology. */
export const MAX_TRUST_PROXY_HOPS = 10;

export type TrustProxySetting = number | false;

export function resolveTrustProxyHops(
  env: NodeJS.ProcessEnv = process.env,
): TrustProxySetting {
  const raw = env.TRUST_PROXY_HOPS?.trim();

  if (!raw) {
    return DEFAULT_TRUST_PROXY_HOPS;
  }

  if (raw === 'false' || raw === '0') {
    return false;
  }

  const hops = Number(raw);

  if (!Number.isInteger(hops) || hops < 1 || hops > MAX_TRUST_PROXY_HOPS) {
    throw new Error(
      `TRUST_PROXY_HOPS must be unset, "0"/"false" to trust no proxy, or an integer between 1 and ${MAX_TRUST_PROXY_HOPS}; received "${raw}".`,
    );
  }

  return hops;
}

/**
 * Applies the resolved setting to the underlying Express instance. Kept beside
 * the parser so the integration specs run the same wiring production does.
 */
export function applyProxyTrust(
  app: INestApplication,
  env: NodeJS.ProcessEnv = process.env,
): TrustProxySetting {
  const setting = resolveTrustProxyHops(env);

  // The Nest http adapter exposes the platform instance as `any`; narrowing it
  // here keeps the Express call typed and lint-clean.
  const instance = app.getHttpAdapter().getInstance() as {
    set(name: string, value: unknown): void;
  };

  instance.set('trust proxy', setting);

  return setting;
}
