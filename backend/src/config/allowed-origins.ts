/**
 * CORS origin resolution shared by main.ts and CookieCsrfGuard.
 *
 * SEC-007: the login endpoint cannot require a double-submit CSRF token
 * (no session exists yet), so it instead rejects POSTs whose browser-declared
 * Origin is outside the deployment's allowed origins. Browsers always attach
 * Origin to cross-origin POSTs and attackers cannot forge it from a victim's
 * browser; non-browser clients without cookies are not a CSRF vector.
 */
import requiredProductionOrigins from './required-production-origins.json';

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/**
 * The production frontends this deployment is known to serve. On 2026-11-22
 * `CORS_ORIGIN` listed only `https://pos.mepersoft.app`, so login from the PWA
 * (`https://pos-pwa.mepersoft.app`) answered 403 "Cross-origin login
 * rejected". This committed list is what the boot warning, the unit tests and
 * the scheduled production probe check; it is NOT a substitute for
 * `CORS_ORIGIN`, never extends the runtime allowlist, and must stay in sync
 * with the real production frontends. No trailing slashes. See
 * `docs/bug-rules/2026-11-22-cors-origin-pwa.md`.
 */
export const REQUIRED_PRODUCTION_ORIGINS: readonly string[] =
  requiredProductionOrigins;

/**
 * `CORS_ORIGIN` is a hand-written comma-separated list, so trim the spaces a
 * deployer may leave around an entry and the trailing slash they may copy from
 * a browser address bar. A browser's `Origin` header never carries a trailing
 * slash, so without this a configured `https://app.example/` could never match
 * the request. Only the configured value is cleaned: no origin is added, no
 * wildcard or prefix match is introduced, and matching stays exact.
 */
function normalizeConfiguredOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export function resolveAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map(normalizeConfiguredOrigin)
    .filter((origin) => origin.length > 0);

  return configured.length > 0 ? configured : DEFAULT_ORIGINS;
}

/** Required production origins the effective allowlist does not cover. */
export function findMissingProductionOrigins(env: NodeJS.ProcessEnv): string[] {
  const allowed = new Set(resolveAllowedOrigins(env));
  return REQUIRED_PRODUCTION_ORIGINS.filter((origin) => !allowed.has(origin));
}

/**
 * Boot-time guard that warns but never exits: a `CORS_ORIGIN` that misses a
 * production frontend shows up as a 403 on that frontend's login, not as a
 * crash, so failing the deploy here would trade a broken login for a down API.
 * Silent outside production to keep local development quiet.
 */
export function warnMissingProductionOrigins(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== 'production') {
    return [];
  }

  const missing = findMissingProductionOrigins(env);
  if (missing.length === 0) {
    return [];
  }

  if (!(env.CORS_ORIGIN ?? '').trim()) {
    console.warn(
      `[cors] NODE_ENV=production but CORS_ORIGIN is unset; only the localhost defaults are allowed, so login from ${missing.join(', ')} will be rejected with 403 "Cross-origin login rejected". Set CORS_ORIGIN to the deployed frontend origins.`,
    );
    return missing;
  }

  console.warn(
    `[cors] CORS_ORIGIN is missing required production frontend origin(s): ${missing.join(', ')}. Login from those Origins will be rejected with 403 "Cross-origin login rejected". CORS_ORIGIN remains the only allowlist; this warning just names the gap.`,
  );
  return missing;
}
