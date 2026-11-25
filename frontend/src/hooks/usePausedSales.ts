import { useEffect, useState } from "react";
import { safeGetItem, safeSetItem } from "@/lib/utils";
import { effectiveStock } from "@/lib/product-type";
import type { CartItem } from "@/types";

export interface PausedSale {
  id: string;
  cart: CartItem[];
  customerId: string | "";
  discountAmount: number;
  pausedAt: string;
  customerName?: string;
}

// Old `paused_sales` entries have no owner. Leave them byte-identical: they are
// hidden from every scope and never reassigned or overwritten automatically.
const PAUSED_SALES_PREFIX = "pos_paused_sales:";

/**
 * Stable identity of a paused sale's content: same customer + same cart lines
 * (product, quantity, prices, discount). Used to avoid stacking duplicate
 * paused sales for the very same order.
 */
function pausedSaleSignature(cart: CartItem[], customerId: string | ""): string {
  const lines = cart
    .map((item) =>
      [
        item.productId,
        item.quantity,
        Number(item.unitPrice),
        Number(item.discountAmount),
        item.discountPercent ?? 0,
      ].join("|"),
    )
    .sort();
  return `${customerId}::${lines.join("&")}`;
}

function loadPausedSales(key: string): PausedSale[] {
  const saved = safeGetItem(key);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved) as PausedSale[];
    // Normalize any duplicate saved entries (identical customer + cart),
    // keeping the most recently paused one.
    const seen = new Set<string>();
    return [...parsed]
      .sort(
        (a, b) =>
          new Date(b.pausedAt).getTime() - new Date(a.pausedAt).getTime(),
      )
      .filter((sale) => {
        const sig = pausedSaleSignature(sale.cart, sale.customerId);
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      });
  } catch {
    return [];
  }
}

/**
 * Paused drafts belong to a caller-supplied scope tuple (user, organization,
 * site). A change of scope must never render, resume, overwrite or delete the
 * drafts of another scope.
 */
export function usePausedSales(scope: string) {
  const key = PAUSED_SALES_PREFIX + scope;
  const [saved, setSaved] = useState(() => ({
    key,
    sales: loadPausedSales(key),
  }));
  // A new scope must never render or persist the previous scope's drafts.
  const active =
    saved.key === key ? saved : { key, sales: loadPausedSales(key) };
  if (active !== saved) setSaved(active);
  const pausedSales = active.sales;

  useEffect(() => {
    safeSetItem(key, JSON.stringify(pausedSales));
  }, [key, pausedSales]);

  const setPausedSales = (update: (previous: PausedSale[]) => PausedSale[]) =>
    setSaved((previous) =>
      previous.key === key
        ? { key, sales: update(previous.sales) }
        : previous,
    );

  const pauseSale = (
    cart: CartItem[],
    customerId: string | "",
    discountAmount: number,
    customerName?: string
  ) => {
    if (cart.length === 0) {
      throw new Error("No items in cart");
    }

    const pausedSale: PausedSale = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 11),
      cart,
      customerId,
      discountAmount,
      pausedAt: new Date().toISOString(),
      customerName,
    };

    setPausedSales((prev) => {
      const sig = pausedSaleSignature(cart, customerId);
      const existingIndex = prev.findIndex(
        (s) => pausedSaleSignature(s.cart, s.customerId) === sig,
      );
      // Refresh the existing identical paused sale (new pausedAt) instead of
      // stacking a duplicate for the very same order.
      if (existingIndex >= 0) {
        return prev.map((s, i) =>
          i === existingIndex
            ? {
                ...s,
                discountAmount,
                customerName,
                pausedAt: pausedSale.pausedAt,
              }
            : s,
        );
      }
      return [...prev, pausedSale];
    });
    return pausedSale.id;
  };

  const getPausedSale = (id: string) => {
    const sale = pausedSales.find((s) => s.id === id);
    if (!sale) {
      throw new Error("Paused sale not found");
    }

    // Backfill availableStock for paused sales saved before the field existed
    const migratedCart = sale.cart.map((item) => ({
      ...item,
      availableStock: item.availableStock ?? effectiveStock(item.product),
    }));

    return { ...sale, cart: migratedCart };
  };

  const deletePausedSale = (id: string) => {
    setPausedSales((prev) => prev.filter((s) => s.id !== id));
  };

  const resumeSale = (id: string) => {
    const sale = getPausedSale(id);
    deletePausedSale(id);
    return sale;
  };

  const clearAllPausedSales = () => {
    setPausedSales(() => []);
  };

  return {
    pausedSales,
    pauseSale,
    resumeSale,
    getPausedSale,
    deletePausedSale,
    clearAllPausedSales,
    isLoaded: true,
  };
}
