"use client";

import { useEffect } from "react";
import Image from "next/image";
import {
  X,
  ShoppingCart,
  Trash2,
  Package,
  Percent,
  Pause,
  Play,
  User,
  HandCoins,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Stepper } from "@/components/ui/Stepper";
import { PaymentMethodCards } from "@/components/pos/PaymentMethodCards";
import { formatCurrency } from "@/lib/utils";
import type { CartItem } from "@/types";

function cartItemOffer(item: CartItem) {
  const price = item.product?.effectiveSalePrice;
  const listPrice = Number(item.product?.salePrice);
  if (typeof price !== "number" || !Number.isFinite(listPrice)) return null;
  if (price <= 0 || price >= listPrice) return null;
  const percent = Math.max(0, Math.round(100 - (price / listPrice) * 100));
  return percent > 0 ? { percent } : null;
}

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
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-up Sheet Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Carrito de compras"
        className="relative z-10 flex h-[92dvh] max-h-[92dvh] w-full flex-col rounded-t-2xl border-t border-border/80 bg-card shadow-2xl overflow-hidden animate-slide-in-bottom"
      >
        {/* Pull handle & Header (Pinned Top) */}
        <div className="flex flex-col border-b border-border/60 bg-muted/15 px-5 pt-3 pb-3 shrink-0">
          <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div>
                <h2 className="text-sm font-semibold text-foreground leading-tight">
                  Carrito de Compras
                </h2>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {cart.length === 1 ? "1 producto agregado" : `${cart.length} productos agregados`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Cerrar carrito"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Unified Scrollable Body: Cart Items + Customer + Totals + Payment Methods */}
        <div className="scrollbar-app flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* Cart Items Section */}
          <div className="space-y-2.5">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <ShoppingCart className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-foreground">Carrito vacío</p>
                <p className="text-xs text-muted-foreground">Agrega productos para comenzar</p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.productId}
                  className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 p-3"
                >
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted/60 border border-border/50 flex items-center justify-center">
                    {item.product.imageUrl ? (
                      <Image
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : (
                      <Package className="h-5 w-5 text-muted-foreground/50" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground line-clamp-1 mb-1">
                      {item.product.name}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums mb-1.5">
                      {cartItemOffer(item) && (
                        <Badge
                          variant="danger"
                          className="shrink-0 text-[9px] px-1.5 py-0 font-mono uppercase rounded-md"
                        >
                          Oferta -{cartItemOffer(item)!.percent}%
                        </Badge>
                      )}
                      {Number.isFinite(Number(item.originalUnitPrice)) &&
                        Number(item.unitPrice) !== Number(item.originalUnitPrice) && (
                          <s className="text-muted-foreground/60 line-through">
                            {formatCurrency(Number(item.originalUnitPrice))}
                          </s>
                        )}
                      <span className="font-medium text-foreground">
                        {formatCurrency(item.unitPrice)}
                      </span>{" "}
                      × {item.quantity}
                      {item.discountAmount > 0 && (
                        <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                          (-{formatCurrency(item.discountAmount)})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Stepper
                        value={item.quantity}
                        min={0}
                        max={item.availableStock}
                        size="sm"
                        onChange={(value) => onUpdateQuantity(item.productId, value)}
                      />
                      {item.quantity >= item.availableStock && (
                        <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          máx.
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenDiscountModal(item.productId)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/80 text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                        title="Descuento"
                      >
                        <Percent className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col items-end justify-between gap-3 shrink-0">
                    <span className="stat-number text-sm font-semibold text-foreground tabular-nums">
                      {formatCurrency(
                        item.quantity * item.unitPrice - item.discountAmount,
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveFromCart(item.productId)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
                      aria-label={`Eliminar ${item.product.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Customer Selection */}
          <div>
            <button
              type="button"
              onClick={onOpenCustomerModal}
              className="flex items-center gap-2 w-full h-9 px-3 rounded-lg border border-border/70 bg-background/80 text-sm text-foreground hover:border-foreground/25 transition-colors overflow-hidden"
            >
              <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="truncate text-xs font-medium">
                {selectedCustomerName || "Cliente General (opcional)"}
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
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <HandCoins className="w-3.5 h-3.5" />
            {isFinancing ? "Iniciando financiación…" : "Financiar a crédito"}
          </button>

          {/* Totals Breakdown */}
          <div className="rounded-lg bg-muted/25 px-3.5 py-2.5 border border-border/60">
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 mb-1.5 pb-1.5 border-b border-border/40 tabular-nums">
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
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Método de Pago
            </p>
            <PaymentMethodCards
              selectedMethod={selectedPaymentMethod}
              onMethodChange={onPaymentMethodChange}
            />
          </div>
        </div>

        {/* Pinned Bottom Checkout Action Bar */}
        <div className="border-t border-border/80 bg-card p-3.5 shrink-0 pb-[calc(0.875rem+env(safe-area-inset-bottom))] shadow-lg">
          <Button
            className="w-full h-11 text-base font-bold shadow-md shadow-primary/20"
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
