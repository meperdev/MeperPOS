/**
 * Catalog of the capabilities an organization can turn on or off.
 *
 * Adding a module here is the only change needed to make it administrable:
 * the admin API lists the catalog, the administration screen renders it and
 * `BusinessModulesService.isEnabled` answers for any of its ids.
 */
export interface BusinessModuleDefinition {
  id: string;
  name: string;
  description: string;
}

export const BUSINESS_MODULE_CATALOG = [
  {
    id: 'vehicles',
    name: 'Vehículos',
    description: 'Placas, modelos y vehículos asociados a cada cliente.',
  },
] as const satisfies readonly BusinessModuleDefinition[];

/**
 * Derived from the catalog, so adding a module widens the union by itself and
 * a call site cannot name a capability that does not exist.
 */
export type BusinessModuleId = (typeof BUSINESS_MODULE_CATALOG)[number]['id'];

export function findModuleDefinition(
  moduleId: string,
): (typeof BUSINESS_MODULE_CATALOG)[number] | undefined {
  return BUSINESS_MODULE_CATALOG.find((module) => module.id === moduleId);
}
