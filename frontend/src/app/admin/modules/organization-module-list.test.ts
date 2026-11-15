import { describe, expect, it } from "vitest";
import type { Organization } from "@/hooks/useAdmin";
import {
  MODULE_STATE_FILTER_OPTIONS,
  filterOrganizationsByModuleState,
  moduleState,
} from "./organization-module-list";

function org(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org-1",
    name: "Cafetería Demo",
    slug: "cafeteria-demo",
    status: "ACTIVE",
    plan: "PRO",
    trialEndsAt: null,
    billingStatus: "PAID",
    taxId: null,
    phone: null,
    address: null,
    active: true,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

const enabled = org({ id: "enabled", enabledModules: ["vehicles"] });
const disabled = org({ id: "disabled", enabledModules: [] });
const unknown = org({ id: "unknown", enabledModules: undefined });

describe("moduleState", () => {
  it("reads the module state the admin list reports", () => {
    expect(moduleState(enabled, "vehicles")).toBe("enabled");
    expect(moduleState(disabled, "vehicles")).toBe("disabled");
    expect(moduleState(org({ enabledModules: ["other"] }), "vehicles")).toBe(
      "disabled",
    );
  });

  it("treats a missing enabledModules field as unknown, never as disabled", () => {
    expect(moduleState(unknown, "vehicles")).toBe("unknown");
  });
});

describe("filterOrganizationsByModuleState", () => {
  it("keeps unknown organizations out of both settled state filters", () => {
    const all = [enabled, disabled, unknown];

    expect(filterOrganizationsByModuleState(all, "vehicles", "ALL")).toEqual(
      all,
    );
    expect(filterOrganizationsByModuleState(all, "vehicles", "ENABLED")).toEqual(
      [enabled],
    );
    expect(
      filterOrganizationsByModuleState(all, "vehicles", "DISABLED"),
    ).toEqual([disabled]);
  });

  it("offers the three state filters in Spanish sentence case", () => {
    expect(MODULE_STATE_FILTER_OPTIONS.map((option) => option.label)).toEqual([
      "Todos",
      "Activados",
      "Desactivados",
    ]);
  });
});
