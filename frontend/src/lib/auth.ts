export type AppRole =
  | "OWNER"
  | "ADMIN"
  | "MEMBER"
  | "CASHIER"
  | "INVENTORY_USER"
  | "SUPER_ADMIN";

import hierarchyTable from "./role-hierarchy.table.json";

/**
 * The role hierarchy RolesGuard applies: OWNER ⊃ ADMIN ⊃ MEMBER ⊃ CASHIER, and
 * INVENTORY_USER inherits nothing. The table is a copy of the backend's
 * `role-hierarchy.table.json`, kept identical by `role-hierarchy.test.ts`.
 */
const HIERARCHY: Record<string, readonly string[]> = hierarchyTable;

/** Every role `userRole` acts as, itself first. Unknown values map to themselves. */
export function getEffectiveRoles(userRole: AppRole | string): AppRole[] {
  const inherited = Object.hasOwn(HIERARCHY, userRole)
    ? HIERARCHY[userRole]
    : [userRole];
  return [...inherited] as AppRole[];
}

/**
 * Display gate only, never a security boundary. SUPER_ADMIN passes every check,
 * mirroring the platform bypass in RolesGuard, which the table does not model.
 */
export function hasAnyRole(
  userRole: AppRole | string | undefined,
  requiredRoles: string[]
): boolean {
  if (!userRole || requiredRoles.length === 0) return false;
  if (userRole === "SUPER_ADMIN") return true;
  const effective = getEffectiveRoles(userRole);
  return requiredRoles.some((role) => effective.includes(role as AppRole));
}
