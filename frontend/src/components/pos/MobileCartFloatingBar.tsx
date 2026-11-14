"use client";

import { ShoppingCart, ChevronUp } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { CartItem } from "@/types";

interface MobileCartFloatingBarProps {
  cart: CartItem[];
  total: number;
  onClick: () => void;
}

export function MobileCartFloatingBar({
  cart,
  total,
  onClick,
}: MobileCartFloatingBarProps) {
  if (cart.length === 0) return null;

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 p-3 bg-card/95 backdrop-blur-md border-t border-border/80 shadow-xl pb-[calc(0.75rem+env(safe-area-inset-bottom))] animate-slide-in-bottom">
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center justify-between gap-3 bg-primary text-white p-3.5 rounded-2xl shadow-lg shadow-primary/25 active:scale-[0.99] transition-transform"
        aria-label={`Ver carrito: ${totalItems} productos por ${formatCurrency(total)}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-white shrink-0">
            <ShoppingCart className="h-5 w-5" />
            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold font-mono text-white px-1 shadow-xs ring-2 ring-primary">
              {totalItems}
            </span>
          </div>
          <div className="text-left min-w-0">
            <p className="text-[11px] font-medium text-white/80 uppercase tracking-wider leading-none mb-1">
              Ver carrito
            </p>
            <p className="stat-number text-base font-extrabold text-white leading-none truncate">
              {formatCurrency(total)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 bg-white/15 px-3 py-1.5 rounded-xl font-bold text-xs text-white">
          <span>Abrir</span>
          <ChevronUp className="h-4 w-4" />
        </div>
      </button>
    </div>
  );
}
