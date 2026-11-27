import { OrgRole } from '@prisma/client';
import type { RoleType } from '../decorators/roles.decorator';
import hierarchyTable from './role-hierarchy.table.json';

/**
 * The organization role hierarchy, in one place: ADMIN ⊃ CASHIER, and
 * INVENTORY_USER inherits nothing. `RolesGuard` and the alert feed
 * both read it, so a route and the feed cannot disagree about who is an admin.
 * The table lives in `role-hierarchy.table.json`; the frontend keeps an identical
 * copy (`frontend/src/lib/role-hierarchy.table.json`) pinned by a contract test.
 *
 * SUPER_ADMIN maps only to itself here; `RolesGuard` lets it through every
 * `@Roles` route separately (platform bypass), which this table does not model.
 */
const HIERARCHY = parseHierarchy(hierarchyTable);

/**
 * JSON imports widen to `string[]`, so the table is checked when the module
 * loads: every role of the enum (plus SUPER_ADMIN) needs a row and every value
 * must be a known role. A bad table stops the boot instead of authorizing.
 */
export function parseHierarchy(
  table: Record<string, readonly string[]>,
): Record<RoleType, readonly RoleType[]> {
  const known = new Set<string>([...Object.values(OrgRole), 'SUPER_ADMIN']);
  for (const role of known) {
    if (!Array.isArray(table[role])) {
      throw new Error(`role-hierarchy.table.json has no row for ${role}`);
    }
  }
  for (const [role, inherited] of Object.entries(table)) {
    if (!inherited.includes(role)) {
      throw new Error(
        `role-hierarchy.table.json: ${role} does not include itself`,
      );
    }
    const unknown = [role, ...inherited].filter((value) => !known.has(value));
    if (unknown.length > 0) {
      throw new Error(
        `role-hierarchy.table.json names unknown roles: ${unknown.join(', ')}`,
      );
    }
  }
  return table as Record<RoleType, readonly RoleType[]>;
}

/** Every role `role` acts as, itself first. Unknown values map to themselves. */
export function effectiveRoles(role: RoleType): RoleType[] {
  // Own keys only: an unknown value such as "constructor" must not reach
  // Object.prototype and must map to itself (deny), as it always did.
  return Object.hasOwn(HIERARCHY, role) ? [...HIERARCHY[role]] : [role];
}

/** Whether `role` reaches `required` through the hierarchy. */
export function hasEffectiveRole(role: RoleType, required: RoleType): boolean {
  return effectiveRoles(role).includes(required);
}
