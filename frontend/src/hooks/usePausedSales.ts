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

const PAUSED_SALES_KEY = "paused_sales";

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

export function usePausedSales() {
  const [pausedSales, setPausedSales] = useState<PausedSale[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    const saved = safeGetItem(PAUSED_SALES_KEY);
    if (!saved) {
      return [];
    }

    try {
      const parsed = JSON.parse(saved) as PausedSale[];
      // Normalize any duplicate saved entries (identical customer + cart),
      // keeping the most recently paused one.
      const seen = new Set<string>();
      const deduped: PausedSale[] = [];
      for (const sale of [...parsed].sort(
        (a, b) => new Date(b.pausedAt).getTime() - new Date(a.pausedAt).getTime(),
      )) {
        const sig = pausedSaleSignature(sale.cart, sale.customerId);
        if (!seen.has(sig)) {
          seen.add(sig);
          deduped.push(sale);
        }
      }
      return deduped;
    } catch {
      return [];
    }
  });

  useEffect(() => {
    safeSetItem(PAUSED_SALES_KEY, JSON.stringify(pausedSales));
  }, [pausedSales]);

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

  const resumeSale = (id: string) => {
    const sale = pausedSales.find((s) => s.id === id);
    if (!sale) {
      throw new Error("Paused sale not found");
    }

    // Backfill availableStock for paused sales saved before the field existed
    const migratedCart = sale.cart.map((item) => ({
      ...item,
      availableStock: item.availableStock ?? effectiveStock(item.product),
    }));

    setPausedSales((prev) => prev.filter((s) => s.id !== id));
    return { ...sale, cart: migratedCart };
  };

  const deletePausedSale = (id: string) => {
    setPausedSales((prev) => prev.filter((s) => s.id !== id));
  };

  const clearAllPausedSales = () => {
    setPausedSales([]);
  };

  return {
    pausedSales,
    pauseSale,
    resumeSale,
    deletePausedSale,
    clearAllPausedSales,
    isLoaded: true,
  };
}
