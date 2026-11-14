import { describe, it, expect } from "vitest";
import type { Organization } from "@/hooks/useAdmin";
import { buildAttentionItems } from "./attention";

const now = new Date("2026-11-01T12:00:00.000Z");

function org(overrides: Partial<Organization>): Organization {
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
    userCount: 7,
    ...overrides,
  };
}

describe("buildAttentionItems", () => {
  it("ignores a healthy tenant", () => {
    expect(buildAttentionItems([org({})], now)).toEqual([]);
  });

  it("flags an expired trial before anything else", () => {
    const items = buildAttentionItems(
      [org({ status: "TRIAL", trialEndsAt: "2026-10-30T12:00:00.000Z", billingStatus: "OVERDUE" })],
      now,
    );
    expect(items).toEqual([
      { id: "org-1", name: "Cafetería Demo", reason: "Prueba vencida", severity: 1 },
    ]);
  });

  it("flags billing in mora through either signal", () => {
    expect(
      buildAttentionItems([org({ billingStatus: "OVERDUE" })], now)[0]?.reason,
    ).toBe("Facturación en mora");
    expect(
      buildAttentionItems([org({ status: "PAST_DUE" })], now)[0]?.reason,
    ).toBe("Facturación en mora");
  });

  it("flags a suspended tenant and a trial that ends this week", () => {
    expect(
      buildAttentionItems([org({ status: "SUSPENDED" })], now)[0],
    ).toMatchObject({ reason: "Suspendida", severity: 2 });

    expect(
      buildAttentionItems(
        [org({ status: "TRIAL", trialEndsAt: "2026-11-04T12:00:00.000Z" })],
        now,
      )[0],
    ).toMatchObject({ reason: "Prueba vence en 3 días", severity: 2 });

    expect(
      buildAttentionItems(
        [org({ status: "TRIAL", trialEndsAt: "2026-11-01T18:00:00.000Z" })],
        now,
      )[0],
    ).toMatchObject({ reason: "Prueba vence hoy" });
  });

  it("flags a tenant without users last", () => {
    expect(buildAttentionItems([org({ userCount: 0 })], now)[0]).toMatchObject({
      reason: "Sin usuarios",
      severity: 3,
    });
  });

  it("orders by severity and caps the queue", () => {
    const organizations = [
      org({ id: "healthy", name: "Sana" }),
      org({ id: "sin-usuarios", name: "Zeta", userCount: 0 }),
      org({ id: "suspendida", name: "Beta", status: "SUSPENDED" }),
      org({ id: "mora-1", name: "Alfa", billingStatus: "OVERDUE" }),
      org({ id: "mora-2", name: "Delta", status: "PAST_DUE" }),
      org({ id: "trial", name: "Gama", status: "TRIAL", trialEndsAt: "2026-11-04T12:00:00.000Z" }),
      org({ id: "mora-3", name: "Epsilon", billingStatus: "OVERDUE" }),
      org({ id: "mora-4", name: "Omega", billingStatus: "OVERDUE" }),
    ];

    const items = buildAttentionItems(organizations, now);

    expect(items).toHaveLength(5);
    expect(items.map((item) => item.reason)).toEqual([
      "Facturación en mora",
      "Facturación en mora",
      "Facturación en mora",
      "Facturación en mora",
      "Suspendida",
    ]);
    expect(items.map((item) => item.name)).toEqual([
      "Alfa",
      "Delta",
      "Epsilon",
      "Omega",
      "Beta",
    ]);
  });
});
