import { COMMON_PASSWORDS } from '../common/validators/password.policy';

/**
 * Production SuperAdmin provisioning plan (issue #116 / AUDIT-FINDING-010,
 * criterion #2).
 *
 * Pure decision logic, no I/O: given the operator-provided environment and the
 * current state of the target user (if any), it returns exactly one action. The
 * thin CLI in backend/prisma/provision.ts executes only that action against the
 * database, so every security rule here is unit-testable without a connection.
 *
 * The development demo seed (backend/prisma/seed.ts) must never be the
 * production bootstrap: it hardcodes a public password and creates demo data.
 * This module is the production-safe alternative.
 */

/**
 * Deliberately stricter than the shared PASSWORD_MIN_LENGTH (10): this password
 * bootstraps an entire production deployment, is set by hand exactly once and is
 * never rotated by the application.
 */
export const MIN_SUPERADMIN_PASSWORD_LENGTH = 12;

/**
 * Values documented in this repository (the deployment runbook sample) so that
 * operators recognize them. Being public, they can never protect a production
 * account, so the provisioning path refuses them explicitly.
 */
export const DOCUMENTED_SAMPLE_PASSWORDS: readonly string[] = [
  'cambiar-esta-clave-produccion',
];

/**
 * Single denylist for provisioning: the shared password policy denylist
 * (see common/validators/password.policy.ts, issue #48 Slice B) plus the
 * documented samples. Keeping one list avoids a second, drifting source of
 * truth about which passwords are public.
 */
export const KNOWN_WEAK_PASSWORDS: readonly string[] = [
  ...new Set([
    ...COMMON_PASSWORDS.map((entry) => entry.toLowerCase()),
    ...DOCUMENTED_SAMPLE_PASSWORDS.map((entry) => entry.toLowerCase()),
  ]),
];

const KNOWN_WEAK_PASSWORD_SET = new Set(KNOWN_WEAK_PASSWORDS);

export type ProvisioningRefusalCode =
  | 'MISSING_SUPERADMIN_EMAIL'
  | 'MISSING_SUPERADMIN_PASSWORD'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_KNOWN_DEFAULT'
  | 'PASSWORD_BLANK'
  | 'PASSWORD_SURROUNDING_WHITESPACE'
  | 'EXISTING_USER_NOT_SUPERADMIN'
  | 'RESET_USER_NOT_FOUND'
  | 'RESET_TARGET_NOT_SUPERADMIN';

export interface ProvisioningRefusal {
  action: 'refuse';
  code: ProvisioningRefusalCode;
  /** Actionable, non-secret explanation for the operator. */
  reason: string;
}

export interface ProvisioningCreatePlan {
  action: 'create';
  email: string;
  password: string;
}

export interface ProvisioningNoopPlan {
  action: 'noop';
  email: string;
  userId: string;
}

export interface ProvisioningPromotePlan {
  action: 'promote';
  email: string;
  userId: string;
}

/**
 * Replaces the password of an existing SuperAdmin. Only reachable with the
 * explicit SUPERADMIN_RESET_PASSWORD=true opt-in, and only for an account that
 * is already a SuperAdmin: a lost password must never create or promote one.
 */
export interface ProvisioningResetPasswordPlan {
  action: 'reset-password';
  email: string;
  password: string;
  userId: string;
}

export type ProvisioningPlan =
  | ProvisioningRefusal
  | ProvisioningCreatePlan
  | ProvisioningNoopPlan
  | ProvisioningPromotePlan
  | ProvisioningResetPasswordPlan;

export interface ProvisioningExistingUser {
  id: string;
  email: string;
  isSuperAdmin: boolean;
}

export interface ProvisioningInput {
  email?: string | null;
  password?: string | null;
  /** Set from SUPERADMIN_PROMOTE === 'true'. Explicit consent is required. */
  promoteExistingUser?: boolean;
  /** Set from SUPERADMIN_RESET_PASSWORD === 'true'. Explicit consent is required. */
  resetPassword?: boolean;
  existingUser?: ProvisioningExistingUser | null;
}

/** Single normalization used for the lookup and for the created account. */
export function normalizeSuperAdminEmail(email?: string | null): string {
  return (email ?? '').trim().toLowerCase();
}

function isKnownWeakPassword(password: string): boolean {
  return KNOWN_WEAK_PASSWORD_SET.has(password.trim().toLowerCase());
}

function refuse(
  code: ProvisioningRefusalCode,
  reason: string,
): ProvisioningRefusal {
  return { action: 'refuse', code, reason };
}

/**
 * Password rules shared by the create and the reset paths, so a reset cannot
 * accept a value the bootstrap would have refused.
 *
 * Returns the validated secret or a refusal; the ordering below is the contract
 * pinned by provisioning-plan.spec.ts.
 */
function validatePassword(
  rawPassword: string | null | undefined,
  intent: 'create' | 'reset',
): { password: string } | ProvisioningRefusal {
  const password = rawPassword ?? '';
  const action = intent === 'create' ? 'create' : 'reset';

  if (password.length === 0) {
    return refuse(
      'MISSING_SUPERADMIN_PASSWORD',
      `SUPERADMIN_PASSWORD is required to ${action} the SuperAdmin: export a unique value of at least ${MIN_SUPERADMIN_PASSWORD_LENGTH} characters in the shell that runs this command.`,
    );
  }

  // Checked before the length rule: this rejection is the more specific and
  // more actionable one for a value that is already public.
  if (isKnownWeakPassword(password)) {
    return refuse(
      'PASSWORD_KNOWN_DEFAULT',
      'SUPERADMIN_PASSWORD matches the shared password denylist or a value documented in this repository (the development seed or the runbook samples). Choose a unique value that appears nowhere in the project.',
    );
  }

  // Whitespace satisfies every length rule while protecting nothing: 12 spaces
  // are longer than the minimum and still hide no secret, so the value is
  // rejected as blank before length is ever considered (review R3-1).
  if (password.trim().length === 0) {
    return refuse(
      'PASSWORD_BLANK',
      `SUPERADMIN_PASSWORD contains only whitespace. Set a real, unique secret of at least ${MIN_SUPERADMIN_PASSWORD_LENGTH} characters; blank padding never protects the account.`,
    );
  }

  // Refused explicitly instead of silently trimmed: an invisible leading or
  // trailing space becomes an undiagnosable login mismatch, and padding must
  // never be able to satisfy the minimum-length rule below. Once this rule has
  // passed, raw length and effective length are the same value.
  if (password !== password.trim()) {
    return refuse(
      'PASSWORD_SURROUNDING_WHITESPACE',
      'SUPERADMIN_PASSWORD starts or ends with whitespace. Remove the leading or trailing spaces so the stored secret matches what you type at login, and so padding cannot stand in for real length.',
    );
  }

  if (password.length < MIN_SUPERADMIN_PASSWORD_LENGTH) {
    return refuse(
      'PASSWORD_TOO_SHORT',
      `SUPERADMIN_PASSWORD is shorter than the required minimum of ${MIN_SUPERADMIN_PASSWORD_LENGTH} characters. Choose a longer unique password.`,
    );
  }

  return { password };
}

/**
 * Decides what the production bootstrap must do. Never throws, never returns
 * the password inside a refusal, and never adopts an existing non-SuperAdmin
 * account without explicit opt-in.
 */
export function planProvisioning(input: ProvisioningInput): ProvisioningPlan {
  const email = normalizeSuperAdminEmail(input.email);

  if (!email) {
    return refuse(
      'MISSING_SUPERADMIN_EMAIL',
      'SUPERADMIN_EMAIL is required: export the address that owns the production SuperAdmin account in the shell that runs this command (railway run does not inject it), then run it again.',
    );
  }

  const existingUser = input.existingUser ?? null;

  // A reset is destructive to live sessions, so it requires the explicit
  // SUPERADMIN_RESET_PASSWORD opt-in. This branch runs before the idempotent
  // one: an operator who lost the password must not get the `noop` that leaves
  // the old hash in place. It never creates or promotes an account, so a lost
  // password cannot widen who is a SuperAdmin.
  if (input.resetPassword) {
    if (!existingUser) {
      return refuse(
        'RESET_USER_NOT_FOUND',
        `No user exists for ${email}, so there is no SuperAdmin password to reset. Run the provisioning command without SUPERADMIN_RESET_PASSWORD to create the account first.`,
      );
    }

    if (!existingUser.isSuperAdmin) {
      return refuse(
        'RESET_TARGET_NOT_SUPERADMIN',
        `The user for ${email} is not a SuperAdmin, so this command will not reset its password. Use the SuperAdmin address, or grant SuperAdmin on purpose with SUPERADMIN_PROMOTE=true.`,
      );
    }

    const validated = validatePassword(input.password, 'reset');
    if ('action' in validated) {
      return validated;
    }

    return {
      action: 'reset-password',
      email,
      password: validated.password,
      userId: existingUser.id,
    };
  }

  // Idempotency: an existing SuperAdmin is left untouched, and no password is
  // needed to re-run the command.
  if (existingUser && existingUser.isSuperAdmin) {
    return { action: 'noop', email, userId: existingUser.id };
  }

  if (existingUser) {
    if (input.promoteExistingUser) {
      return { action: 'promote', email, userId: existingUser.id };
    }

    return refuse(
      'EXISTING_USER_NOT_SUPERADMIN',
      `A user already exists for ${email} and is not a SuperAdmin. Set SUPERADMIN_PROMOTE=true to grant SuperAdmin on purpose, or choose a different SUPERADMIN_EMAIL.`,
    );
  }

  const validated = validatePassword(input.password, 'create');
  if ('action' in validated) {
    return validated;
  }

  return { action: 'create', email, password: validated.password };
}
