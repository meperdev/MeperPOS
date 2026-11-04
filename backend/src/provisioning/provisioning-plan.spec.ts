import {
  DOCUMENTED_SAMPLE_PASSWORDS,
  KNOWN_WEAK_PASSWORDS,
  MIN_SUPERADMIN_PASSWORD_LENGTH,
  planProvisioning,
} from './provisioning-plan';
import type {
  ProvisioningPlan,
  ProvisioningRefusal,
} from './provisioning-plan';

/**
 * Unit contract for the production SuperAdmin provisioning decision
 * (issue #116 / AUDIT-FINDING-010, criterion #2).
 *
 * Pure decision logic: no Nest bootstrap, no database, no faker, no demo data.
 * The CLI in backend/prisma/provision.ts only executes the single operation the
 * plan describes, so every security rule lives here and is testable offline.
 *
 * Precedence is fixed and explicit:
 *   1. email presence
 *   2. explicit reset (SUPERADMIN_RESET_PASSWORD): target must exist and already
 *      be a SuperAdmin, then the password rules apply
 *   3. existing user  -> noop / promote / refuse (no password needed)
 *   4. password presence
 *   5. known default or documented sample  (more specific than length)
 *   6. whitespace-only  (satisfies any length rule while hiding nothing)
 *   7. surrounding whitespace  (invisible at login, and padding would fake length)
 *   8. minimum length
 *
 * Rules 6 and 7 run before the length rule on purpose: once a password has been
 * proven to have no surrounding whitespace, its raw and effective lengths are
 * the same, so the minimum-length rule cannot be satisfied by padding.
 */

const REFUSAL_CODE = /^[A-Z][A-Z0-9_]*$/;

/** Narrows the union and fails with a readable message otherwise. */
function asRefusal(plan: ProvisioningPlan): ProvisioningRefusal {
  if (plan.action !== 'refuse') {
    throw new Error(
      `expected a refusal, received action "${plan.action}" (${JSON.stringify(plan)})`,
    );
  }
  return plan;
}

describe('production provisioning plan (criterion #2)', () => {
  const validEmail = 'owner@meperpos.com';
  const validPassword = 'ClaveSegura1';

  it('pins the published minimum password length at 12 characters', () => {
    expect(MIN_SUPERADMIN_PASSWORD_LENGTH).toBe(12);
  });

  it('refuses when SUPERADMIN_EMAIL is missing', () => {
    for (const email of [undefined, null, '', '   ']) {
      const plan = asRefusal(
        planProvisioning({ email, password: validPassword }),
      );
      expect(plan.code).toBe('MISSING_SUPERADMIN_EMAIL');
    }
  });

  it('refuses when SUPERADMIN_PASSWORD is missing and the user does not exist', () => {
    for (const password of [undefined, null, '']) {
      const plan = asRefusal(
        planProvisioning({ email: validEmail, password, existingUser: null }),
      );
      expect(plan.code).toBe('MISSING_SUPERADMIN_PASSWORD');
    }
  });

  it('refuses a password shorter than the minimum length', () => {
    const short = 'ClaveSegur1'; // 11 characters
    expect(short.length).toBe(MIN_SUPERADMIN_PASSWORD_LENGTH - 1);

    const plan = asRefusal(
      planProvisioning({ email: validEmail, password: short }),
    );
    expect(plan.code).toBe('PASSWORD_TOO_SHORT');
  });

  it('accepts a password exactly at the minimum length', () => {
    const plan = planProvisioning({
      email: validEmail,
      password: validPassword,
    });
    expect(validPassword.length).toBe(MIN_SUPERADMIN_PASSWORD_LENGTH);
    expect(plan.action).toBe('create');
  });

  it('refuses known default bootstrap passwords, including the dev seed value', () => {
    // 'admin123' is hardcoded in backend/prisma/seed.ts and is also shorter than
    // the minimum. The known-default rule is more specific, so it wins.
    for (const password of ['admin123', 'ADMIN123', ' admin123 ']) {
      const plan = asRefusal(planProvisioning({ email: validEmail, password }));
      expect(plan.code).toBe('PASSWORD_KNOWN_DEFAULT');
    }
  });

  it('refuses a password equal to a documented sample', () => {
    // The deployment runbook shows this value as a placeholder so operators
    // recognize it; it must never protect a production SuperAdmin. It is longer
    // than the minimum, so only the documented-sample rule can reject it.
    const documentedSample = 'cambiar-esta-clave-produccion';
    expect(documentedSample.length).toBeGreaterThan(
      MIN_SUPERADMIN_PASSWORD_LENGTH,
    );

    const plan = asRefusal(
      planProvisioning({ email: validEmail, password: documentedSample }),
    );
    expect(plan.code).toBe('PASSWORD_KNOWN_DEFAULT');
    expect(DOCUMENTED_SAMPLE_PASSWORDS).toContain(documentedSample);
    expect(KNOWN_WEAK_PASSWORDS).toContain(documentedSample);
  });

  it('refuses a whitespace-only password (review R3-1)', () => {
    // Length alone accepts this value: it is not empty, it is not on the
    // denylist after trimming, and it reaches the minimum length. The account
    // would be created with a secret that hides nothing.
    const blank = ' '.repeat(MIN_SUPERADMIN_PASSWORD_LENGTH);
    expect(blank.length).toBe(MIN_SUPERADMIN_PASSWORD_LENGTH);

    const plan = asRefusal(
      planProvisioning({ email: validEmail, password: blank }),
    );

    expect(plan.code).toBe('PASSWORD_BLANK');
  });

  it('refuses every whitespace-only password, not just spaces', () => {
    const blanks = [
      '\t'.repeat(MIN_SUPERADMIN_PASSWORD_LENGTH),
      '\n'.repeat(MIN_SUPERADMIN_PASSWORD_LENGTH),
      ' \t\n'.repeat(Math.ceil(MIN_SUPERADMIN_PASSWORD_LENGTH / 3)),
    ];

    for (const blank of blanks) {
      expect(blank.trim()).toBe('');
      const plan = asRefusal(
        planProvisioning({ email: validEmail, password: blank }),
      );
      expect(plan.code).toBe('PASSWORD_BLANK');
    }
  });

  it('refuses a password with leading or trailing whitespace', () => {
    // An invisible trailing space is an undiagnosable login mismatch, and the
    // operator cannot see why the copied value fails.
    const padded = `${validPassword} `;
    expect(padded.length).toBeGreaterThan(MIN_SUPERADMIN_PASSWORD_LENGTH);
    expect(padded.trim()).toBe(validPassword);

    const plan = asRefusal(
      planProvisioning({ email: validEmail, password: padded }),
    );

    expect(plan.code).toBe('PASSWORD_SURROUNDING_WHITESPACE');
    expect(plan.reason).toMatch(/whitespace|espacio/i);
  });

  it('refuses padding that would fake the minimum length', () => {
    // Seven effective characters padded with five spaces reach the minimum only
    // on the raw string. Enforcing the length rule on padding would defeat it.
    const faked = 'Clave1!'.padEnd(MIN_SUPERADMIN_PASSWORD_LENGTH, ' ');
    expect(faked.length).toBe(MIN_SUPERADMIN_PASSWORD_LENGTH);
    expect(faked.trim().length).toBeLessThan(MIN_SUPERADMIN_PASSWORD_LENGTH);

    const plan = asRefusal(
      planProvisioning({ email: validEmail, password: faked }),
    );

    expect(plan.code).toBe('PASSWORD_SURROUNDING_WHITESPACE');
  });

  it('reuses the shared password denylist as the single source of truth', () => {
    // 'password123' comes from common/validators/password.policy.ts and is not
    // a documented provisioning sample: the plan must not maintain a second,
    // drifting list of weak passwords.
    const sharedPolicyOnly = 'password123';
    expect(DOCUMENTED_SAMPLE_PASSWORDS).not.toContain(sharedPolicyOnly);
    expect(KNOWN_WEAK_PASSWORDS).toContain(sharedPolicyOnly);

    const plan = asRefusal(
      planProvisioning({ email: validEmail, password: sharedPolicyOnly }),
    );
    expect(plan.code).toBe('PASSWORD_KNOWN_DEFAULT');
  });

  it('returns create when no user exists for the email and the env is valid', () => {
    const plan = planProvisioning({
      email: '  Owner@MeperPOS.com  ',
      password: validPassword,
      existingUser: null,
    });

    expect(plan.action).toBe('create');
    if (plan.action !== 'create') {
      throw new Error('unreachable');
    }
    // The normalized email is the identity used for the lookup and the create.
    expect(plan.email).toBe(validEmail);
    expect(plan.password).toBe(validPassword);
  });

  it('is idempotent: an existing SuperAdmin yields noop', () => {
    const existingUser = {
      id: 'user-1',
      email: validEmail,
      isSuperAdmin: true,
    };

    const first = planProvisioning({
      email: validEmail,
      password: validPassword,
      existingUser,
    });
    const second = planProvisioning({
      email: validEmail,
      password: validPassword,
      existingUser,
    });

    expect(first).toEqual(second);
    expect(first.action).toBe('noop');
    if (first.action !== 'noop') {
      throw new Error('unreachable');
    }
    expect(first.userId).toBe(existingUser.id);
  });

  it('does not require the password again when the SuperAdmin already exists', () => {
    const plan = planProvisioning({
      email: validEmail,
      password: undefined,
      existingUser: { id: 'user-1', email: validEmail, isSuperAdmin: true },
    });

    expect(plan.action).toBe('noop');
  });

  it('refuses to adopt an existing non-SuperAdmin user without explicit opt-in', () => {
    const existingUser = {
      id: 'user-2',
      email: validEmail,
      isSuperAdmin: false,
    };

    const plan = asRefusal(
      planProvisioning({
        email: validEmail,
        password: validPassword,
        existingUser,
      }),
    );

    expect(plan.code).toBe('EXISTING_USER_NOT_SUPERADMIN');
    expect(plan.reason).toContain('SUPERADMIN_PROMOTE');
  });

  it('promotes the existing non-SuperAdmin user only with SUPERADMIN_PROMOTE=true', () => {
    const existingUser = {
      id: 'user-2',
      email: validEmail,
      isSuperAdmin: false,
    };

    const plan = planProvisioning({
      email: validEmail,
      password: validPassword,
      existingUser,
      promoteExistingUser: true,
    });

    expect(plan.action).toBe('promote');
    if (plan.action !== 'promote') {
      throw new Error('unreachable');
    }
    expect(plan.userId).toBe(existingUser.id);
    expect(plan.email).toBe(validEmail);
  });

  it('resets the password of an existing SuperAdmin only on explicit opt-in', () => {
    const existingUser = {
      id: 'user-1',
      email: validEmail,
      isSuperAdmin: true,
    };

    // Without the flag the command stays idempotent: a lost password is not
    // silently replaced by re-running the normal bootstrap.
    expect(
      planProvisioning({
        email: validEmail,
        password: validPassword,
        existingUser,
      }).action,
    ).toBe('noop');

    const plan = planProvisioning({
      email: '  Owner@MeperPOS.com  ',
      password: validPassword,
      existingUser,
      resetPassword: true,
    });

    expect(plan.action).toBe('reset-password');
    if (plan.action !== 'reset-password') {
      throw new Error('unreachable');
    }
    expect(plan.userId).toBe(existingUser.id);
    expect(plan.email).toBe(validEmail);
    expect(plan.password).toBe(validPassword);
  });

  it('refuses a reset when no user exists for the email', () => {
    const plan = asRefusal(
      planProvisioning({
        email: validEmail,
        password: validPassword,
        existingUser: null,
        resetPassword: true,
      }),
    );

    expect(plan.code).toBe('RESET_USER_NOT_FOUND');
  });

  it('refuses a reset on an existing non-SuperAdmin, even with SUPERADMIN_PROMOTE=true', () => {
    const existingUser = {
      id: 'user-2',
      email: validEmail,
      isSuperAdmin: false,
    };

    const plan = asRefusal(
      planProvisioning({
        email: validEmail,
        password: validPassword,
        existingUser,
        promoteExistingUser: true,
        resetPassword: true,
      }),
    );

    expect(plan.code).toBe('RESET_TARGET_NOT_SUPERADMIN');
  });

  it.each([
    ['short', 'corta', 'PASSWORD_TOO_SHORT'],
    ['known default', 'admin123', 'PASSWORD_KNOWN_DEFAULT'],
    ['whitespace-only', '            ', 'PASSWORD_BLANK'],
    ['padded', '  ClaveSegura1  ', 'PASSWORD_SURROUNDING_WHITESPACE'],
  ])(
    'applies the create password rules to a %s reset password',
    (_label, password, code) => {
      const plan = asRefusal(
        planProvisioning({
          email: validEmail,
          password,
          existingUser: { id: 'user-1', email: validEmail, isSuperAdmin: true },
          resetPassword: true,
        }),
      );

      expect(plan.code).toBe(code);
    },
  );

  it('never returns an ambiguous action and always carries an actionable refusal', () => {
    const refusals: ProvisioningPlan[] = [
      planProvisioning({ email: undefined, password: validPassword }),
      planProvisioning({ email: validEmail, password: undefined }),
      planProvisioning({ email: validEmail, password: 'corta' }),
      planProvisioning({ email: validEmail, password: 'admin123' }),
      planProvisioning({
        email: validEmail,
        password: validPassword,
        existingUser: { id: 'user-2', email: validEmail, isSuperAdmin: false },
      }),
    ];

    for (const plan of refusals) {
      const refusal = asRefusal(plan);
      expect(refusal.code).toMatch(REFUSAL_CODE);
      // Actionable: a non-empty, human-readable instruction.
      expect(refusal.reason.length).toBeGreaterThan(20);
      // Non-secret: never echoes the supplied password back.
      expect(JSON.stringify(refusal)).not.toContain(validPassword);
      expect(JSON.stringify(refusal)).not.toContain('admin123');
    }
  });

  it('signals every possible action through a discriminated union', () => {
    const actions = new Set<string>([
      planProvisioning({ email: validEmail, password: validPassword }).action,
      planProvisioning({
        email: validEmail,
        password: validPassword,
        existingUser: { id: 'u', email: validEmail, isSuperAdmin: true },
      }).action,
      planProvisioning({
        email: validEmail,
        password: validPassword,
        existingUser: { id: 'u', email: validEmail, isSuperAdmin: false },
        promoteExistingUser: true,
      }).action,
      planProvisioning({
        email: validEmail,
        password: validPassword,
        existingUser: { id: 'u', email: validEmail, isSuperAdmin: true },
        resetPassword: true,
      }).action,
      planProvisioning({ email: validEmail, password: 'admin123' }).action,
    ]);

    expect(actions).toEqual(
      new Set(['create', 'noop', 'promote', 'reset-password', 'refuse']),
    );
  });
});
