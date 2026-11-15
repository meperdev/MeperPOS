import type { Organization } from "@/hooks/useAdmin";

/** Authoritative module state for one organization, as the server reported it. */
export type ModuleState = "enabled" | "disabled" | "unknown";

export type ModuleStateFilter = "ALL" | "ENABLED" | "DISABLED";

export const MODULE_STATE_FILTER_OPTIONS: {
  value: ModuleStateFilter;
  label: string;
}[] = [
  { value: "ALL", label: "Todos" },
  { value: "ENABLED", label: "Activados" },
  { value: "DISABLED", label: "Desactivados" },
];

/**
 * The admin organization list reports `enabledModules`. A missing field means
 * the server did not answer for that tenant, which is unknown state — never an
 * implicit disabled default.
 */
export function moduleState(
  organization: Organization,
  moduleId: string,
): ModuleState {
  if (!organization.enabledModules) {
    return "unknown";
  }
  return organization.enabledModules.includes(moduleId)
    ? "enabled"
    : "disabled";
}

/**
 * Narrows an already searched list by the settled module state. Organizations
 * with unknown state are only visible under `ALL`, because neither activation
 * filter can honestly claim them.
 */
export function filterOrganizationsByModuleState(
  organizations: Organization[],
  moduleId: string,
  state: ModuleStateFilter,
): Organization[] {
  if (state === "ALL") {
    return organizations;
  }

  const expected: ModuleState = state === "ENABLED" ? "enabled" : "disabled";
  return organizations.filter(
    (organization) => moduleState(organization, moduleId) === expected,
  );
}
