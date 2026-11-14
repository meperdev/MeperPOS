import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * Per-route rate limits, in one place (spec S4.4).
 *
 * The global default stays 100 requests / 60 s (app.module.ts) and covers every
 * ordinary route. Only the routes whose abuse is expensive or dangerous get an
 * explicit limit:
 *
 * - `login` (5/min, tightened from 10/min): a password-guessing surface. The
 *   tracker is the resolved client IP, so this is a per-source limit.
 * - `selectOrganization` (10/min): completes a login and re-issues tokens; it
 *   is reached by every legitimate user once per sign-in, so it must stay
 *   comfortable for shared (NAT'd) office addresses.
 * - `refresh` (30/min): the frontend calls it automatically when a session
 *   expires, so a tight limit would sign people out during normal use while a
 *   generous one still blunts a stolen-token replay loop.
 * - `changePassword` (5/min): rare, highly sensitive, and it revokes sessions.
 * - `selectOrg` (10/min): the authenticated variant of `selectOrganization`.
 *
 * There is no `register` and no password-recovery route in this API (checked
 * against `auth.controller.ts`), so no limit is invented for them.
 */
export const THROTTLE_LIMITS: Record<
  string,
  Pick<ThrottlerOptions, 'limit' | 'ttl'>
> = {
  login: { limit: 5, ttl: 60_000 },
  selectOrganization: { limit: 10, ttl: 60_000 },
  refresh: { limit: 30, ttl: 60_000 },
  changePassword: { limit: 5, ttl: 60_000 },
  selectOrg: { limit: 10, ttl: 60_000 },
};

/** The shape `@Throttle()` expects: one entry per named throttler. */
export function throttle(route: keyof typeof THROTTLE_LIMITS): {
  default: Pick<ThrottlerOptions, 'limit' | 'ttl'>;
} {
  return { default: THROTTLE_LIMITS[route] };
}
