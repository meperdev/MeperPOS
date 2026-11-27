import { OrgRole } from '@prisma/client';
import {
  effectiveRoles,
  hasEffectiveRole,
  parseHierarchy,
} from './role-hierarchy';
import table from './role-hierarchy.table.json';
import { effectiveRoles as alertsEffectiveRoles } from '../../alerts/alerts.logic';

describe('role hierarchy (single source for RolesGuard and alerts)', () => {
  it('is the three-role enum of S1: ADMIN, CASHIER, INVENTORY_USER', () => {
    expect(Object.values(OrgRole)).toEqual([
      'ADMIN',
      'CASHIER',
      'INVENTORY_USER',
    ]);
  });

  it.each([
    [OrgRole.ADMIN, ['ADMIN', 'CASHIER']],
    [OrgRole.CASHIER, ['CASHIER']],
    [OrgRole.INVENTORY_USER, ['INVENTORY_USER']],
    ['SUPER_ADMIN', ['SUPER_ADMIN']],
  ] as const)('%s keeps exactly its current effective roles', (role, roles) => {
    expect(effectiveRoles(role)).toEqual(roles);
  });

  it('answers whether a role reaches another through inheritance', () => {
    expect(hasEffectiveRole(OrgRole.ADMIN, OrgRole.CASHIER)).toBe(true);
    expect(hasEffectiveRole(OrgRole.CASHIER, OrgRole.ADMIN)).toBe(false);
    expect(hasEffectiveRole(OrgRole.INVENTORY_USER, OrgRole.CASHIER)).toBe(
      false,
    );
  });

  it('is the very function the alert feed uses', () => {
    expect(alertsEffectiveRoles).toBe(effectiveRoles);
  });

  it('refuses a table that misses a role or names an unknown one', () => {
    const missing: Record<string, readonly string[]> = { ...table };
    delete missing.CASHIER;
    expect(() => parseHierarchy(missing)).toThrow('no row for CASHIER');
    expect(() =>
      parseHierarchy({ ...table, CASHIER: ['CASHIER', 'MANAGER'] }),
    ).toThrow('unknown roles: MANAGER');
  });

  it('refuses a row that does not include its own role', () => {
    expect(() => parseHierarchy({ ...table, ADMIN: ['CASHIER'] })).toThrow(
      'ADMIN does not include itself',
    );
  });

  it.each(['constructor', 'toString', '__proto__', 'SOMETHING_ELSE'])(
    'maps unknown role %s to itself, as master did',
    (role) => {
      expect(
        effectiveRoles(role as Parameters<typeof effectiveRoles>[0]),
      ).toEqual([role]);
    },
  );
});
