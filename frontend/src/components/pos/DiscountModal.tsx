"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Modal } from "@/components/ui/Modal";
import { cn, formatCurrency } from "@/lib/utils";
import type { CartItem } from "@/types";

/** Which edit the dialog is set up for: a rebate or a final unit price. */
type DiscountMode = "discount" | "price";
/** The unit of the rebate field: pesos off the line, or a percentage of it. */
type DiscountUnit = "$" | "%";

const PERCENT_CHIPS = [5, 10, 15, 20];

/**
 * Renders a percentage the way a shopkeeper reads it: whole numbers stay whole
 * (`10%`) and anything finer carries one decimal with a comma (`2,5%`).
 */
function formatPercent(value: number) {
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(1).replace(".", ",")}%`;
}

export interface DiscountModalProps {
  isOpen: boolean;
  /** The line being edited; `null` renders nothing. */
  item: CartItem | null;
  /** Mirrors the backend's override permission; gates the "Precio final" mode. */
  canOverridePrice: boolean;
  onClose: () => void;
  /** Fixed rebate in pesos for the whole line. */
  onApplyDiscount: (productId: string, amount: number) => void;
  /** Percentage rebate that keeps scaling with the quantity. */
  onApplyDiscountPercent: (productId: string, percent: number) => void;
  /** Manual unit price override. */
  onApplyPrice: (productId: string, price: number) => void;
}

/**
 * One dialog for adjusting a cart line: a rebate (the default, and the only
 * option for roles that cannot touch the price) or a final unit price.
 *
 * It owns only the draft values — every committed change leaves through a
 * callback, so the POS page stays the single owner of the cart. The preview is
 * display-only math on values the page already computed; it never re-derives
 * taxes or any other server-owned number.
 */
export function DiscountModal({
  isOpen,
  item,
  canOverridePrice,
  onClose,
  onApplyDiscount,
  onApplyDiscountPercent,
  onApplyPrice,
}: DiscountModalProps) {
  const [mode, setMode] = useState<DiscountMode>("discount");
  const [unit, setUnit] = useState<DiscountUnit>("$");
  const [discountValue, setDiscountValue] = useState(0);
  const [priceValue, setPriceValue] = useState(() => item?.unitPrice ?? 0);

  if (!item) return null;

  const quantity = item.quantity;
  const grossBefore = item.unitPrice * quantity;
  // A percentage rebate is a share of the line; a peso rebate is the amount.
  const rebateAmount =
    unit === "%" ? (grossBefore * discountValue) / 100 : discountValue;
  const lineAfter =
    mode === "price"
      ? Math.max(0, priceValue * quantity)
      : Math.max(0, grossBefore - rebateAmount);
  const finalUnitPrice =
    quantity > 0 ? Math.round(lineAfter / quantity) : lineAfter;
  const savings = Math.max(0, grossBefore - lineAfter);
  const savingsPercent = grossBefore > 0 ? (savings / grossBefore) * 100 : 0;

  const priceUnchanged = priceValue === item.unitPrice;
  const rebateUnchanged =
    unit === "%"
      ? discountValue === item.discountPercent
      : discountValue === item.discountAmount && item.discountPercent === undefined;
  // A percentage lives between 1 and 100; a peso rebate can never exceed the
  // line it is taken from, so the total floors at zero instead of going under.
  const discountOutOfRange =
    unit === "%" ? discountValue > 100 : discountValue > grossBefore;
  const canSubmit =
    mode === "price"
      ? priceValue > 0 && !priceUnchanged
      : discountValue > 0 && !discountOutOfRange && !rebateUnchanged;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (mode === "price") {
      onApplyPrice(item.productId, priceValue);
      return;
    }
    if (unit === "%") {
      onApplyDiscountPercent(item.productId, discountValue);
      return;
    }
    onApplyDiscount(item.productId, discountValue);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Agregar descuento"
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {mode === "price" ? "Aplicar precio" : "Aplicar descuento"}
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="space-y-3.5"
      >
        {/* What is being adjusted, and from what price. */}
        <div
          data-testid="discount-modal-item"
          className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 p-3"
        >
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
              {item.product.name}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
              {quantity} × {formatCurrency(item.unitPrice)} c/u
            </p>
          </div>
          <span className="shrink-0 text-[13px] font-medium text-foreground tabular-nums">
            {formatCurrency(grossBefore)}
          </span>
        </div>

        {/* Two ways to move the same amount of money. Roles that cannot
            override the price only see the rebate, with no switch at all. */}
        {canOverridePrice && (
          <div
            role="group"
            aria-label="Tipo de ajuste"
            className="grid grid-cols-2 gap-1 rounded-lg border border-border/70 bg-muted/30 p-1"
          >
            {(
              [
                { value: "price", label: "Precio final" },
                { value: "discount", label: "Descuento" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={mode === option.value}
                onClick={() => setMode(option.value)}
                className={cn(
                  "h-8 rounded-md text-[13px] font-medium transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  mode === option.value
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {mode === "price" ? (
          <CurrencyInput
            label="Nuevo precio unitario"
            value={priceValue}
            onChange={setPriceValue}
            placeholder="0"
          />
        ) : (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <CurrencyInput
                  label="Monto del descuento"
                  value={discountValue}
                  onChange={setDiscountValue}
                  prefixText={unit === "%" ? "%" : "$"}
                  placeholder="0"
                />
              </div>
              <div
                role="group"
                aria-label="Unidad del descuento"
                className="mb-0.5 flex h-10 shrink-0 items-center gap-0.5 rounded-lg border border-border/70 bg-muted/30 p-0.5 sm:h-9"
              >
                {(["$", "%"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={unit === option}
                    onClick={() => {
                      if (unit === option) return;
                      setUnit(option);
                      // 5.000 pesos means nothing as 5.000 percent.
                      setDiscountValue(0);
                    }}
                    className={cn(
                      "flex h-full w-8 items-center justify-center rounded-md text-[13px] font-semibold tabular-nums transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      unit === option
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            {discountOutOfRange && (
              <p role="alert" className="text-[13px] font-medium text-danger-text">
                El descuento no puede superar el total de la línea (
                {formatCurrency(grossBefore)}).
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {PERCENT_CHIPS.map((percent) => {
                const active = unit === "%" && discountValue === percent;
                return (
                  <button
                    key={percent}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setUnit("%");
                      setDiscountValue(percent);
                    }}
                    className={cn(
                      "h-8 rounded-md border px-2.5 text-[13px] font-medium tabular-nums transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      active
                        ? "border-primary/40 bg-primary-light text-primary-text"
                        : "border-border/70 bg-card text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    {percent}%
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* The money the line will carry once this is applied. */}
        <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Precio original</span>
            <span
              data-testid="discount-preview-original"
              className={cn(
                "font-medium tabular-nums",
                savings > 0
                  ? "text-muted-foreground line-through"
                  : "text-foreground",
              )}
            >
              {formatCurrency(item.unitPrice)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted-foreground">Precio final</span>
            <span
              data-testid="discount-preview-final"
              className="text-lg font-semibold tabular-nums text-foreground"
            >
              {formatCurrency(finalUnitPrice)}
            </span>
          </div>
          {savings > 0 && (
            <div className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-1.5 text-[13px] text-success-text">
              <span>Ahorro</span>
              <span
                data-testid="discount-preview-savings"
                className="font-medium tabular-nums text-success-text"
              >
                {formatCurrency(savings)} · {formatPercent(savingsPercent)}
              </span>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
