/**
 * SuperAdmin bootstrap credential policy (SEC-004 remediation).
 *
 * The seed script used to create the SUPER_ADMIN account with a hardcoded
 * default password that was printed to the console — a total-takeover
 * backdoor if the seed ever ran against a real environment. The password
 * must now be supplied through SUPER_ADMIN_PASSWORD and must not be a
 * known-weak value. Fail-closed: without a valid password the seed skips
 * the account (and says so) instead of inventing one.
 */

/** Passwords that must never bootstrap a SUPER_ADMIN (denylist by design). */
const FORBIDDEN_PASSWORDS = new Set([
  'admin123',
  'password',
  '123456',
  'superadmin',
  'admin',
  'admin1234',
  'admin12345',
]);

export const SUPER_ADMIN_PASSWORD_ENV = 'SUPER_ADMIN_PASSWORD';

export interface SuperAdminPasswordResolution {
  ok: boolean;
  password?: string;
  reason?: string;
}

export function resolveSuperAdminPassword(
  env: NodeJS.ProcessEnv,
): SuperAdminPasswordResolution {
  const password = env[SUPER_ADMIN_PASSWORD_ENV];

  if (!password || password.trim().length === 0) {
    return {
      ok: false,
      reason: `${SUPER_ADMIN_PASSWORD_ENV} is not set: skipping the SUPER_ADMIN account (fail-closed). Set it explicitly to bootstrap one.`,
    };
  }

  if (password.length < 10) {
    return {
      ok: false,
      reason: `${SUPER_ADMIN_PASSWORD_ENV} must be at least 10 characters: skipping the SUPER_ADMIN account.`,
    };
  }

  if (FORBIDDEN_PASSWORDS.has(password.toLowerCase())) {
    return {
      ok: false,
      reason: `${SUPER_ADMIN_PASSWORD_ENV} is a known-weak value: skipping the SUPER_ADMIN account.`,
    };
  }

  return { ok: true, password };
}
