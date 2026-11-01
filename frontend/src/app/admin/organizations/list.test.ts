import { describe, it, expect } from "vitest";
import type { Organization } from "@/hooks/useAdmin";
import {
  PAGE_SIZE,
  filterOrganizations,
  paginate,
  sortOrganizations,
  trialInfo,
} from "./list";
import { billingLabel } from "./labels";

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
    ...overrides,
  };
}

const cafetera = org({ id: "a", name: "Cafetería Demo", slug: "cafeteria-demo" });
const tienda = org({
  id: "b",
  name: "Tienda Norte",
  slug: "tienda-norte",
  status: "SUSPENDED",
  plan: "BASIC",
  userCount: 12,
  createdAt: "2026-02-01T00:00:00.000Z",
});
const panaderia = org({
  id: "c",
  name: "Panadería Sur",
  slug: "panaderia-sur",
  status: "TRIAL",
  plan: "PRO",
  userCount: 3,
  createdAt: "2026-03-01T00:00:00.000Z",
});

describe("filterOrganizations", () => {
  it("matches the name ignoring case and accents", () => {
    expect(
      filterOrganizations([cafetera, tienda], { search: "cafeteria", status: "ALL", plan: "ALL" }),
    ).toEqual([cafetera]);
  });

  it("matches the slug", () => {
    expect(
      filterOrganizations([cafetera, tienda], { search: "norte", status: "ALL", plan: "ALL" }),
    ).toEqual([tienda]);
  });

  it("narrows by status and plan together with the search", () => {
    const filtered = filterOrganizations([cafetera, tienda, panaderia], {
      search: "",
      status: "TRIAL",
      plan: "PRO",
    });
    expect(filtered).toEqual([panaderia]);
  });

  it("returns everything when the filters are clear", () => {
    expect(
      filterOrganizations([cafetera, tienda], { search: "  ", status: "ALL", plan: "ALL" }),
    ).toHaveLength(2);
  });
});

describe("sortOrganizations", () => {
  it("sorts newest and oldest first", () => {
    const all = [cafetera, panaderia, tienda];
    expect(sortOrganizations(all, "recent").map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(sortOrganizations(all, "oldest").map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts by user count and by name", () => {
    const all = [cafetera, panaderia, tienda];
    expect(sortOrganizations(all, "users").map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(sortOrganizations(all, "name").map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("does not mutate the input", () => {
    const all = [cafetera, panaderia, tienda];
    sortOrganizations(all, "name");
    expect(all.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 11 }, (_, index) => index);

  it("returns the first page and the remainder", () => {
    expect(paginate(items, 1)).toEqual({ items: items.slice(0, 10), page: 1, totalPages: 2 });
    expect(paginate(items, 2).items).toEqual([10]);
    expect(PAGE_SIZE).toBe(10);
  });

  it("clamps a page outside the range", () => {
    expect(paginate(items, 9).page).toBe(2);
    expect(paginate(items, 0).page).toBe(1);
  });

  it("keeps one empty page for an empty list", () => {
    expect(paginate([], 1)).toEqual({ items: [], page: 1, totalPages: 1 });
  });
});

describe("trialInfo", () => {
  const now = new Date("2026-11-01T12:00:00.000Z");

  it("reports a missing trial as a dash", () => {
    expect(trialInfo(null, now)).toEqual({ label: "—", tone: "default" });
  });

  it("marks an elapsed trial and a same-day trial", () => {
    expect(trialInfo("2026-10-30T12:00:00.000Z", now)).toEqual({
      label: "Vencido",
      tone: "danger",
    });
    expect(trialInfo("2026-11-01T20:00:00.000Z", now)).toEqual({
      label: "Vence hoy",
      tone: "warning",
    });
  });

  it("warns during the last week and stays quiet after it", () => {
    expect(trialInfo("2026-11-04T12:00:00.000Z", now)).toEqual({
      label: "3 días",
      tone: "warning",
    });
    expect(trialInfo("2026-12-01T12:00:00.000Z", now)).toEqual({
      label: "30 días",
      tone: "default",
    });
  });
});

describe("billingLabel", () => {
  it("maps the billing enum to Spanish and falls back safely", () => {
    expect(billingLabel("PAID")).toBe("Pagada");
    expect(billingLabel("PENDING")).toBe("Pendiente");
    expect(billingLabel("OVERDUE")).toBe("En mora");
    expect(billingLabel("UNKNOWN")).toBe("UNKNOWN");
    expect(billingLabel(null)).toBe("—");
  });
});
