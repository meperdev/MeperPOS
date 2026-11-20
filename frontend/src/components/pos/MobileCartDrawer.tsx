"use client";

import { useEffect } from "react";
import { X, ShoppingCart, Pause, Play, User, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CartLine } from "@/components/pos/CartLine";
import { PaymentMethodCards } from "@/components/pos/PaymentMethodCards";
import { formatCurrency } from "@/lib/utils";
import type { CartItem } from "@/types";

export interface MobileCartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  selectedCustomerName?: string | null;
  onOpenCustomerModal: () => void;
  pausedSalesCount: number;
  onOpenPausedSales: () => void;
  onPauseSale: () => void;
  selectedPaymentMethod: "CASH" | "CARD" | "TRANSFER";
  onPaymentMethodChange: (method: "CASH" | "CARD" | "TRANSFER") => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onOpenDiscountModal: (productId: string) => void;
  onRemoveFromCart: (productId: string) => void;
  onCheckout: () => void;
  onFinance: () => void;
  canFinance: boolean;
  isFinancing?: boolean;
  isPending?: boolean;
}

export function MobileCartDrawer({
  isOpen,
  onClose,
  cart,
  discountAmount,
  total,
  selectedCustomerName,
  onOpenCustomerModal,
  pausedSalesCount,
  onOpenPausedSales,
  onPauseSale,
  selectedPaymentMethod,
  onPaymentMethodChange,
  onUpdateQuantity,
  onOpenDiscountModal,
  onRemoveFromCart,
  onCheckout,
  onFinance,
  canFinance,
  isFinancing = false,
  isPending = false,
}: MobileCartDrawerProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 dark:bg-black/60 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-up Sheet Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Carrito de compras"
        className="relative z-10 flex h-[92dvh] max-h-[92dvh] w-full flex-col rounded-t-2xl border-t border-border/80 bg-card shadow-lg shadow-black/10 overflow-hidden animate-slide-in-bottom"
      >
        {/* Pull handle & Header (Pinned Top) */}
        <div className="flex flex-col border-b border-border/60 bg-muted/15 px-5 pt-3 pb-3 shrink-0">
          <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground leading-tight">
                  Carrito de compras
                </h2>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {cart.length === 1 ? "1 producto agregado" : `${cart.length} productos agregados`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Cerrar carrito"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Unified Scrollable Body: Cart Items + Customer + Totals + Payment Methods */}
        <div className="scrollbar-app flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* Cart Items Section */}
          <div className="space-y-2">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <ShoppingCart className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-foreground">Carrito vacío</p>
                <p className="text-xs text-muted-foreground">Agrega productos para comenzar</p>
              </div>
            ) : (
              cart.map((item) => (
                <CartLine
                  key={item.productId}
                  item={item}
                  variant="compact"
                  className="rounded-xl"
                  onQuantityChange={onUpdateQuantity}
                  onDiscount={onOpenDiscountModal}
                  onRemove={onRemoveFromCart}
                />
              ))
            )}
          </div>

          {/* Customer Selection */}
          <div>
            <button
              type="button"
              onClick={onOpenCustomerModal}
              className="flex items-center gap-2 w-full h-10 sm:h-9 px-3 rounded-lg border border-border/70 bg-background/80 text-sm text-foreground hover:border-foreground/25 transition-colors overflow-hidden"
            >
              <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="truncate text-xs font-medium">
                {selectedCustomerName || "Sin cliente (opcional)"}
              </span>
            </button>
          </div>

          {/* Financed sale: quiet secondary action, far from the checkout bar */}
          <button
            type="button"
            onClick={onFinance}
            disabled={cart.length === 0 || !canFinance || isFinancing}
            title={
              !canFinance && cart.length > 0
                ? "Selecciona un cliente para financiar"
                : undefined
            }
            className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <HandCoins className="w-3.5 h-3.5" />
            {isFinancing ? "Iniciando financiación…" : "Financiar a crédito"}
          </button>

          {/* Totals Breakdown */}
          <div className="rounded-lg bg-muted/25 px-3.5 py-2.5 border border-border/60">
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-success-text mb-1.5 pb-1.5 border-b border-border/40 tabular-nums">
                <span>Descuento</span>
                <span className="font-medium">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-muted-foreground">Total</span>
              <span className="stat-number text-lg font-semibold text-primary-text tabular-nums">
                {formatCurrency(total)}
              </span>
            </div>
          </div>

          {/* Pause / Resume */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenPausedSales}
              className="flex-1 text-xs h-8"
            >
              <Play className="w-3.5 h-3.5 mr-1" />
              Reanudar ({pausedSalesCount})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onPauseSale}
              disabled={cart.length === 0}
              className="flex-1 text-xs h-8"
            >
              <Pause className="w-3.5 h-3.5 mr-1" />
              Pausar
            </Button>
          </div>

          {/* Payment Method Selector */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Método de pago
            </p>
            <PaymentMethodCards
              selectedMethod={selectedPaymentMethod}
              onMethodChange={onPaymentMethodChange}
            />
          </div>
        </div>

        {/* Pinned Bottom Checkout Action Bar */}
        <div className="border-t border-border/80 bg-card p-3.5 shrink-0 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
          <Button
            className="w-full h-11 text-base font-semibold"
            size="lg"
            onClick={onCheckout}
            disabled={cart.length === 0}
            loading={isPending}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Cobrar {formatCurrency(total)}
          </Button>
        </div>
      </div>
    </div>
  );
}
