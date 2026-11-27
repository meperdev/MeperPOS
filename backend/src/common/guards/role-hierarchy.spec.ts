import { OrgRole } from '@prisma/client';
import { effectiveRoles, hasEffectiveRole } from './role-hierarchy';
import { effectiveRoles as alertsEffectiveRoles } from '../../alerts/alerts.logic';

describe('role hierarchy (single source for RolesGuard and alerts)', () => {
  it.each([
    [OrgRole.OWNER, ['OWNER', 'ADMIN', 'MEMBER', 'CASHIER']],
    [OrgRole.ADMIN, ['ADMIN', 'MEMBER', 'CASHIER']],
    [OrgRole.MEMBER, ['MEMBER', 'CASHIER']],
    [OrgRole.CASHIER, ['CASHIER']],
    [OrgRole.INVENTORY_USER, ['INVENTORY_USER']],
    ['SUPER_ADMIN', ['SUPER_ADMIN']],
  ] as const)('%s keeps exactly its current effective roles', (role, roles) => {
    expect(effectiveRoles(role)).toEqual(roles);
  });

  it('answers whether a role reaches another through inheritance', () => {
    expect(hasEffectiveRole(OrgRole.OWNER, OrgRole.ADMIN)).toBe(true);
    expect(hasEffectiveRole(OrgRole.MEMBER, OrgRole.ADMIN)).toBe(false);
    expect(hasEffectiveRole(OrgRole.INVENTORY_USER, OrgRole.CASHIER)).toBe(
      false,
    );
  });

  it('is the very function the alert feed uses', () => {
    expect(alertsEffectiveRoles).toBe(effectiveRoles);
  });
});
