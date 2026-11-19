import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_RECENTS_KEY_PREFIX,
  COMMAND_RECENTS_LIMIT,
  canSearchCustomers,
  canSearchSales,
  closeCommandPalette,
  commandRecentsKey,
  currentOrganizationScope,
  filterCommandTargets,
  isCommandPaletteOpen,
  matchesCommandQuery,
  openCommandPalette,
  productSearchSource,
  readCommandRecents,
  recordCommandRecent,
  salesSearchTerm,
  subscribeCommandPalette,
  toggleCommandPalette,
  visibleCommandCreateActions,
} from "@/lib/command-palette";
import { SELECTED_ORGANIZATION_KEY } from "@/lib/session";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  closeCommandPalette();
  localStorage.clear();
});

describe("recent entities", () => {
  it("scopes the ledger to the selected organization", () => {
    localStorage.setItem(SELECTED_ORGANIZATION_KEY, "org-7");

    expect(currentOrganizationScope()).toBe("org-7");
    expect(commandRecentsKey("org-7")).toBe(
      `${COMMAND_RECENTS_KEY_PREFIX}org-7`,
    );
    expect(commandRecentsKey(null)).toBe(`${COMMAND_RECENTS_KEY_PREFIX}global`);
  });

  it("keeps the last five entities, most recent first, without repeating one", () => {
    const key = commandRecentsKey("org-1");

    for (let index = 1; index <= COMMAND_RECENTS_LIMIT + 1; index += 1) {
      recordCommandRecent(key, {
        kind: "product",
        id: `product-${index}`,
        label: `Producto ${index}`,
      });
    }
    recordCommandRecent(key, {
      kind: "customer",
      id: "customer-1",
      label: "Ana Pérez",
    });
    recordCommandRecent(key, {
      kind: "product",
      id: "product-2",
      label: "Producto 2",
    });

    const recents = readCommandRecents(key);

    expect(recents).toHaveLength(COMMAND_RECENTS_LIMIT);
    expect(recents[0]).toEqual({
      kind: "product",
      id: "product-2",
      label: "Producto 2",
    });
    expect(
      recents.filter((entry) => entry.id === "product-2"),
    ).toHaveLength(1);
    // The oldest product fell off; the customer is still there.
    expect(recents.map((entry) => entry.id)).toContain("customer-1");
    expect(recents.map((entry) => entry.id)).not.toContain("product-1");
  });

  it("never stores money or a payload beyond the displayed label", () => {
    const key = commandRecentsKey("org-1");

    recordCommandRecent(key, {
      kind: "sale",
      id: "sale-9",
      label: "Venta 194",
    });

    const raw = localStorage.getItem(key) ?? "";
    // Exactly the three fields the row repaints from: a price would be money
    // the catalog may already have changed.
    expect(JSON.parse(raw)).toEqual([
      { kind: "sale", id: "sale-9", label: "Venta 194" },
    ]);
  });

  it("recovers from a corrupted ledger instead of throwing", () => {
    const key = commandRecentsKey("org-1");
    localStorage.setItem(key, "{not json");

    expect(readCommandRecents(key)).toEqual([]);

    localStorage.setItem(key, JSON.stringify([{ kind: "nope" }, null]));
    expect(readCommandRecents(key)).toEqual([]);
  });
});

describe("create actions", () => {
  it("offers only destinations that already open the creation flow", () => {
    const hrefs = visibleCommandCreateActions("OWNER").map(
      (action) => action.href,
    );

    expect(hrefs).toEqual(["/pos", "/purchase-orders/new"]);
  });

  it("filters with the inherited roles the rail uses", () => {
    expect(
      visibleCommandCreateActions("CASHIER").map((action) => action.label),
    ).toEqual(["Nueva venta"]);
    expect(
      visibleCommandCreateActions("INVENTORY_USER").map(
        (action) => action.label,
      ),
    ).toEqual(["Nueva orden de compra"]);
    expect(visibleCommandCreateActions(undefined)).toEqual([]);
  });
});

describe("screen filtering", () => {
  const screens = [
    { label: "Categorías", href: "/categories" },
    { label: "Inventario", href: "/inventory" },
    { label: "Panel", href: "/dashboard" },
  ];

  it("ignores accents and case, the way the operator types", () => {
    expect(matchesCommandQuery("Categorías", "categorias")).toBe(true);
    expect(matchesCommandQuery("Categorías", "CATEG")).toBe(true);
    expect(filterCommandTargets(screens, "invent")).toEqual([screens[1]]);
  });

  it("returns every screen while the query is empty", () => {
    expect(filterCommandTargets(screens, "   ")).toEqual(screens);
  });

  it("matches nothing for a term no screen carries", () => {
    expect(filterCommandTargets(screens, "arroz")).toEqual([]);
  });
});

describe("sales search term", () => {
  it("strips the way an operator writes a sale number", () => {
    expect(salesSearchTerm("194")).toBe("194");
    expect(salesSearchTerm("#194")).toBe("194");
    expect(salesSearchTerm("venta 194")).toBe("194");
    expect(salesSearchTerm("  Venta   #194 ")).toBe("194");
  });

  it("keeps a customer name untouched", () => {
    expect(salesSearchTerm("ana pérez")).toBe("ana pérez");
  });
});

describe("role scoping of the API-backed groups", () => {
  it("hides sales and customers from the inventory role", () => {
    expect(canSearchSales("INVENTORY_USER")).toBe(false);
    expect(canSearchCustomers("INVENTORY_USER")).toBe(false);
    expect(canSearchSales("CASHIER")).toBe(true);
    expect(canSearchCustomers("OWNER")).toBe(true);
  });

  it("sends the inventory role to the endpoint its token can read", () => {
    // /products/search excludes INVENTORY_USER; GET /products does not.
    expect(productSearchSource("INVENTORY_USER")).toBe("list");
    expect(productSearchSource("CASHIER")).toBe("search");
    expect(productSearchSource("OWNER")).toBe("search");
    expect(productSearchSource(undefined)).toBeNull();
  });
});

describe("palette open state", () => {
  it("notifies subscribers and toggles back to closed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommandPalette(listener);

    openCommandPalette();
    expect(isCommandPaletteOpen()).toBe(true);

    toggleCommandPalette();
    expect(isCommandPaletteOpen()).toBe(false);

    unsubscribe();
    toggleCommandPalette();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
