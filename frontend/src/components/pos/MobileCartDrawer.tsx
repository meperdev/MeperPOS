"use client";

import { ShoppingCart, Pause, Play, User, HandCoins } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
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

/**
 * The phone cart: a bottom sheet with the same lines, totals and checkout bar
 * the desktop column shows. `BottomSheet` owns the shell — the scrim, the grab
 * handle, the drag, the scroll lock and the focus trap — so this component
 * stays a pure rendering of the cart state.
 */
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
  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Carrito de compras"
      subtitle={
        cart.length === 1 ? "1 producto agregado" : `${cart.length} productos agregados`
      }
      titleClassName="text-sm font-semibold leading-tight text-foreground"
      closeLabel="Cerrar carrito"
      className="lg:hidden"
      bodyClassName="p-4 space-y-4"
      footer={
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
      }
    >
      {/* Cart Items Section */}
      <div className="space-y-2">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <ShoppingCart className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm font-semibold text-foreground">Carrito vacío</p>
            <p className="text-[13px] text-muted-foreground">Agrega productos para comenzar</p>
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
          <span className="truncate text-[13px] font-medium">
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
          !canFinance && cart.length > 0 ? "Selecciona un cliente para financiar" : undefined
        }
        className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <HandCoins className="w-3.5 h-3.5" />
        {isFinancing ? "Iniciando financiación…" : "Financiar a crédito"}
      </button>

      {/* Totals Breakdown */}
      <div className="rounded-lg bg-muted/25 px-3.5 py-2.5 border border-border/60">
        {discountAmount > 0 && (
          <div className="flex justify-between text-[13px] text-success-text mb-1.5 pb-1.5 border-b border-border/40 tabular-nums">
            <span>Descuento</span>
            <span className="font-medium">-{formatCurrency(discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-[13px] font-medium text-muted-foreground">Total</span>
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
          className="flex-1 text-[13px] h-8"
        >
          <Play className="w-3.5 h-3.5 mr-1" />
          Reanudar ({pausedSalesCount})
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onPauseSale}
          disabled={cart.length === 0}
          className="flex-1 text-[13px] h-8"
        >
          <Pause className="w-3.5 h-3.5 mr-1" />
          Pausar
        </Button>
      </div>

      {/* Payment Method Selector */}
      <div>
        <p className="text-[13px] font-medium text-muted-foreground mb-2">Método de pago</p>
        <PaymentMethodCards
          selectedMethod={selectedPaymentMethod}
          onMethodChange={onPaymentMethodChange}
        />
      </div>
    </BottomSheet>
  );
}
