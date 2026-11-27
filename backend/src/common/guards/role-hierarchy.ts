import { OrgRole } from '@prisma/client';
import type { RoleType } from '../decorators/roles.decorator';

/**
 * The organization role hierarchy, in one place: OWNER ⊃ ADMIN ⊃ MEMBER ⊃
 * CASHIER, and INVENTORY_USER inherits nothing. `RolesGuard` and the alert feed
 * both read it, so a route and the feed cannot disagree about who is an admin.
 *
 * SUPER_ADMIN maps only to itself here; `RolesGuard` lets it through every
 * `@Roles` route separately (platform bypass), which this table does not model.
 */
const HIERARCHY: Record<RoleType, readonly RoleType[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN'],
  [OrgRole.OWNER]: [
    OrgRole.OWNER,
    OrgRole.ADMIN,
    OrgRole.MEMBER,
    OrgRole.CASHIER,
  ],
  [OrgRole.ADMIN]: [OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.CASHIER],
  [OrgRole.MEMBER]: [OrgRole.MEMBER, OrgRole.CASHIER],
  [OrgRole.CASHIER]: [OrgRole.CASHIER],
  [OrgRole.INVENTORY_USER]: [OrgRole.INVENTORY_USER],
};

/** Every role `role` acts as, itself first. Unknown values map to themselves. */
export function effectiveRoles(role: RoleType): RoleType[] {
  return [...(HIERARCHY[role] ?? [role])];
}

/** Whether `role` reaches `required` through the hierarchy. */
export function hasEffectiveRole(role: RoleType, required: RoleType): boolean {
  return effectiveRoles(role).includes(required);
}
