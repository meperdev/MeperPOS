import { resolveSuperAdminPassword } from './super-admin-credentials';

/**
 * SEC-004 regression: the seed must never invent, print or accept a
 * known-weak SUPER_ADMIN credential. Dynamic PoC (FASE 1) proved the old
 * seed hardcoded and printed the default password; now the account is
 * only created when SUPER_ADMIN_PASSWORD is supplied and healthy.
 */
describe('resolveSuperAdminPassword (SEC-004)', () => {
  it('fails closed when SUPER_ADMIN_PASSWORD is not set', () => {
    const result = resolveSuperAdminPassword({});
    expect(result.ok).toBe(false);
    expect(result.password).toBeUndefined();
    expect(result.reason).toContain('SUPER_ADMIN_PASSWORD');
  });

  it('rejects empty/whitespace-only values', () => {
    expect(resolveSuperAdminPassword({ SUPER_ADMIN_PASSWORD: '   ' }).ok).toBe(
      false,
    );
    expect(resolveSuperAdminPassword({ SUPER_ADMIN_PASSWORD: '' }).ok).toBe(
      false,
    );
  });

  it('rejects the historical hardcoded default credential', () => {
    // The exact value the old seed used (never recreated again).
    expect(
      resolveSuperAdminPassword({ SUPER_ADMIN_PASSWORD: 'admin123' }).ok,
    ).toBe(false);
  });

  it('rejects short passwords (<10 chars)', () => {
    expect(
      resolveSuperAdminPassword({ SUPER_ADMIN_PASSWORD: 'abc123' }).ok,
    ).toBe(false);
  });

  it('accepts a healthy explicit password and returns it', () => {
    const result = resolveSuperAdminPassword({
      SUPER_ADMIN_PASSWORD: 'Credencial-Fuerte-De-Super-Admin',
    });
    expect(result.ok).toBe(true);
    expect(result.password).toBe('Credencial-Fuerte-De-Super-Admin');
  });
});
