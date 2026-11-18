/**
 * CORS origin resolution shared by main.ts and CookieCsrfGuard.
 *
 * SEC-007: the login endpoint cannot require a double-submit CSRF token
 * (no session exists yet), so it instead rejects POSTs whose browser-declared
 * Origin is outside the deployment's allowed origins. Browsers always attach
 * Origin to cross-origin POSTs and attackers cannot forge it from a victim's
 * browser; non-browser clients without cookies are not a CSRF vector.
 */

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function resolveAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return configured.length > 0 ? configured : DEFAULT_ORIGINS;
}
