import { describe, expect, it } from "vitest";
import { getEffectiveRoles, hasAnyRole } from "./auth";

describe("getEffectiveRoles", () => {
  it("OWNER inherits ADMIN, MEMBER, CASHIER and INVENTORY_USER", () => {
    const roles = getEffectiveRoles("OWNER");

    expect(roles).toContain("OWNER");
    expect(roles).toContain("ADMIN");
    expect(roles).toContain("MEMBER");
    expect(roles).toContain("CASHIER");
    expect(roles).toContain("INVENTORY_USER");
  });

  it("ADMIN inherits MEMBER, CASHIER and INVENTORY_USER", () => {
    const roles = getEffectiveRoles("ADMIN");

    expect(roles).toContain("ADMIN");
    expect(roles).toContain("MEMBER");
    expect(roles).toContain("CASHIER");
    expect(roles).toContain("INVENTORY_USER");
  });

  it("SUPER_ADMIN inherits the ADMIN chain", () => {
    const roles = getEffectiveRoles("SUPER_ADMIN");

    expect(roles).toContain("SUPER_ADMIN");
    expect(roles).toContain("ADMIN");
    expect(roles).toContain("MEMBER");
    expect(roles).toContain("CASHIER");
    expect(roles).toContain("INVENTORY_USER");
  });

  it("MEMBER inherits CASHIER only", () => {
    expect(getEffectiveRoles("MEMBER")).toEqual(["MEMBER", "CASHIER"]);
  });

  it("CASHIER only has itself", () => {
    expect(getEffectiveRoles("CASHIER")).toEqual(["CASHIER"]);
  });

  it("INVENTORY_USER inherits nothing", () => {
    expect(getEffectiveRoles("INVENTORY_USER")).toEqual(["INVENTORY_USER"]);
  });

  it("returns the raw role for an unknown role", () => {
    expect(getEffectiveRoles("SOMETHING_ELSE")).toEqual(["SOMETHING_ELSE"]);
  });
});

describe("hasAnyRole", () => {
  it("lets OWNER through a check that only names ADMIN", () => {
    expect(hasAnyRole("OWNER", ["ADMIN"])).toBe(true);
  });

  it("lets SUPER_ADMIN through a check that only names ADMIN", () => {
    expect(hasAnyRole("SUPER_ADMIN", ["ADMIN"])).toBe(true);
  });

  it("lets ADMIN through a check that names ADMIN or INVENTORY_USER", () => {
    expect(hasAnyRole("ADMIN", ["ADMIN", "INVENTORY_USER"])).toBe(true);
  });

  it("lets OWNER through a check that names ADMIN or INVENTORY_USER", () => {
    expect(hasAnyRole("OWNER", ["ADMIN", "INVENTORY_USER"])).toBe(true);
  });

  it("keeps INVENTORY_USER out of an ADMIN-only check", () => {
    expect(hasAnyRole("INVENTORY_USER", ["ADMIN"])).toBe(false);
  });

  it("keeps CASHIER out of an ADMIN-only check", () => {
    expect(hasAnyRole("CASHIER", ["ADMIN"])).toBe(false);
  });

  it("keeps MEMBER out of an ADMIN-only check", () => {
    expect(hasAnyRole("MEMBER", ["ADMIN"])).toBe(false);
  });

  it("returns false for an undefined role", () => {
    expect(hasAnyRole(undefined, ["ADMIN"])).toBe(false);
  });
});
