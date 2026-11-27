import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePausedSales } from "./usePausedSales";
import type { CartItem, Product } from "@/types";

const scope = JSON.stringify(["user-a", "org-a", "site-a"]);
const scopedStorageKey = `pos_paused_sales:${scope}`;

function makeProduct(id: string, salePrice: number): Product {
  return {
    id,
    name: `Producto ${id}`,
    sku: `sku-${id}`,
    barcode: null,
    description: null,
    costPrice: 0,
    salePrice,
    taxRate: 0,
    stock: 10,
    minStock: 1,
    imageUrl: null,
    categoryId: "cat-1",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  };
}

function makeLine(productId: string, unitPrice: number, qty = 1): CartItem {
  return {
    productId,
    product: makeProduct(productId, unitPrice),
    quantity: qty,
    unitPrice,
    originalUnitPrice: unitPrice,
    discountAmount: 0,
    availableStock: 10,
  };
}

describe("usePausedSales — deduplicate identical paused sales", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not add a duplicate paused sale for the same customer + identical cart", () => {
    const { result } = renderHook(() => usePausedSales(scope));
    const cart = [makeLine("p1", 8000)];

    act(() => {
      result.current.pauseSale(cart, "", 0);
    });
    act(() => {
      result.current.pauseSale(cart, "", 0);
    });

    expect(result.current.pausedSales).toHaveLength(1);
  });

  it("keeps distinct carts (different products) separate", () => {
    const { result } = renderHook(() => usePausedSales(scope));

    act(() => {
      result.current.pauseSale([makeLine("p1", 8000)], "", 0);
    });
    act(() => {
      result.current.pauseSale([makeLine("p2", 9000)], "", 0);
    });

    expect(result.current.pausedSales).toHaveLength(2);
  });

  it("normalizes duplicate paused sales already stored in localStorage on load", () => {
    const existing = [
      {
        id: "a",
        customerId: "",
        discountAmount: 0,
        customerName: "Cliente General",
        pausedAt: "2026-08-25T16:29:54.000Z",
        cart: [makeLine("p1", 8000)],
      },
      {
        id: "b",
        customerId: "",
        discountAmount: 0,
        customerName: "Cliente General",
        pausedAt: "2026-08-25T16:37:24.000Z",
        cart: [makeLine("p1", 8000)],
      },
    ];
    localStorage.setItem(scopedStorageKey, JSON.stringify(existing));

    const { result } = renderHook(() => usePausedSales(scope));

    expect(result.current.pausedSales).toHaveLength(1);
    expect(result.current.pausedSales[0].id).toBe("b");
  });

  it("does not collapse sales for different customers", () => {
    const { result } = renderHook(() => usePausedSales(scope));
    const cart = [makeLine("p1", 8000)];

    act(() => {
      result.current.pauseSale(cart, "customer-1", 0);
    });
    act(() => {
      result.current.pauseSale(cart, "customer-2", 0);
    });

    expect(result.current.pausedSales).toHaveLength(2);
  });

  it("never reassigns legacy unscoped drafts or overwrites their storage", () => {
    const legacy = JSON.stringify([{
      id: "legacy",
      customerId: "old-customer",
      discountAmount: 0,
      pausedAt: "2026-08-25T16:37:24.000Z",
      cart: [makeLine("p1", 8000)],
    }]);
    localStorage.setItem("paused_sales", legacy);
    const { result } = renderHook(() => usePausedSales(scope));

    expect(result.current.pausedSales).toEqual([]);
    act(() => result.current.pauseSale([makeLine("p2", 9000)], "", 0));
    expect(localStorage.getItem("paused_sales")).toBe(legacy);
    expect(JSON.parse(localStorage.getItem(scopedStorageKey)!)).toHaveLength(1);
  });

  it.each([
    ["another user", ["user-b", "org-a", "site-a"]],
    ["another organization", ["user-a", "org-b", "site-a"]],
    ["another location", ["user-a", "org-a", "site-b"]],
  ])("hides drafts from %s and keeps them in their original scope", (_label, other) => {
    const { result, rerender } = renderHook(
      ({ current }) => usePausedSales(current),
      { initialProps: { current: scope } },
    );
    let draftId = "";
    act(() => { draftId = result.current.pauseSale([makeLine("p1", 8000)], "", 0); });
    const original = localStorage.getItem(scopedStorageKey);

    rerender({ current: JSON.stringify(other) });
    expect(result.current.pausedSales).toEqual([]);
    expect(() => result.current.resumeSale(draftId)).toThrow("Paused sale not found");
    act(() => result.current.pauseSale([makeLine("p2", 9000)], "", 0));
    expect(localStorage.getItem(scopedStorageKey)).toBe(original);

    rerender({ current: scope });
    expect(result.current.pausedSales.map(({ id }) => id)).toEqual([draftId]);
  });
});
