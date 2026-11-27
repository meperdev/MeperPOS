import { describe, expect, it } from "vitest";
import { getEffectiveRoles, hasAnyRole } from "./auth";

describe("getEffectiveRoles", () => {
  // The same table RolesGuard reads (backend role-hierarchy.table.json); the contract
  // test in role-hierarchy.test.ts keeps the two files identical.
  it.each([
    ["ADMIN", ["ADMIN", "CASHIER"]],
    ["CASHIER", ["CASHIER"]],
    ["INVENTORY_USER", ["INVENTORY_USER"]],
    ["SUPER_ADMIN", ["SUPER_ADMIN"]],
  ] as const)("%s has the backend's effective roles", (role, roles) => {
    expect(getEffectiveRoles(role)).toEqual(roles);
  });

  it("returns the raw role for an unknown role", () => {
    expect(getEffectiveRoles("SOMETHING_ELSE")).toEqual(["SOMETHING_ELSE"]);
  });
});

describe("hasAnyRole", () => {
  it.each([["ADMIN"], ["CASHIER"], ["INVENTORY_USER"], ["ADMIN", "CASHIER"]])(
    "lets SUPER_ADMIN through a check naming %s, as RolesGuard does",
    (...roles) => {
      expect(hasAnyRole("SUPER_ADMIN", roles)).toBe(true);
    },
  );

  it("lets ADMIN through a check that names ADMIN or INVENTORY_USER", () => {
    expect(hasAnyRole("ADMIN", ["ADMIN", "INVENTORY_USER"])).toBe(true);
  });

  it("keeps INVENTORY_USER out of an ADMIN-only check", () => {
    expect(hasAnyRole("INVENTORY_USER", ["ADMIN"])).toBe(false);
  });

  it("keeps CASHIER out of an ADMIN-only check", () => {
    expect(hasAnyRole("CASHIER", ["ADMIN"])).toBe(false);
  });

  it("keeps an empty requirement closed for every role, SUPER_ADMIN included", () => {
    expect(hasAnyRole("SUPER_ADMIN", [])).toBe(false);
    expect(hasAnyRole("ADMIN", [])).toBe(false);
  });

  it("returns false for an undefined role", () => {
    expect(hasAnyRole(undefined, ["ADMIN"])).toBe(false);
  });
});
