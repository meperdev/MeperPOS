"use client";

import Image from "next/image";
import { Package, Percent, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Stepper } from "@/components/ui/Stepper";
import { cn, formatCurrency } from "@/lib/utils";
import type { CartItem } from "@/types";

/**
 * One cart line: a full-height product thumbnail on the left, then a two-row
 * grid that uses the whole remaining width — the name and the line actions on
 * the top row, the quantity stepper and the money on the bottom row.
 *
 * The thumbnail only joins in when the cart column is wide enough to keep the
 * name, the price, the stepper and the total on one line; in the 18rem desktop
 * column it would push the rest into a wrap, so the row reads as text only.
 *
 * It is presentational on purpose — every mutation is handed back to the POS
 * page (or the mobile drawer), which own the cart state, the stock caps and the
 * undo window. Behavior, test ids and aria labels mirror the inline markup this
 * component replaces.
 */
export interface CartLineProps {
  item: CartItem;
  /**
   * `compact` tightens the card for the mobile drawer: one name line, a smaller
   * thumbnail and 40px touch targets. Same data, same callbacks.
   */
  variant?: "default" | "compact";
  className?: string;
  onQuantityChange: (productId: string, quantity: number) => void;
  onDiscount: (productId: string) => void;
  onRemove: (productId: string) => void;
}

/**
 * Detect whether a cart line is carrying an active product promotion based on
 * the product's backend-computed effectiveSalePrice (not on a manual price
 * override). Returns the approximate whole-percent discount, or null when the
 * line is not on offer.
 *
 * Kept in sync with the identical helper in `app/pos/page.tsx`, which still
 * derives the checkout payload from it.
 */
export function cartLineOffer(item: CartItem) {
  // effectiveSalePrice is null/undefined when there is NO active promotion;
  // Number(null) would be 0, so guard the presence explicitly to avoid a
  // bogus "-100%" offer. salePrice may arrive as a Decimal string.
  const price = item.product?.effectiveSalePrice;
  const listPrice = Number(item.product?.salePrice);
  if (typeof price !== "number" || !Number.isFinite(listPrice)) return null;
  if (price <= 0 || price >= listPrice) return null;
  const percent = Math.max(0, Math.round(100 - (price / listPrice) * 100));
  return percent > 0 ? { percent } : null;
}

/**
 * True when the line's price differs from the server-derived price — i.e. a
 * manual override rather than a promotion. Mirrors the backend's 0.01
 * tolerance so the cart never flags noise the API would consider a match.
 */
export function cartLinePriceOverride(item: CartItem) {
  const listPrice = Number(item.product?.salePrice);
  if (!Number.isFinite(listPrice)) return null;
  const effective = item.product?.effectiveSalePrice;
  const serverUnitPrice =
    typeof effective === "number" && Number.isFinite(effective)
      ? effective
      : listPrice;
  const lineUnitPrice = Number(item.unitPrice);
  if (!Number.isFinite(lineUnitPrice)) return null;
  return Math.abs(lineUnitPrice - serverUnitPrice) > 0.01
    ? { serverUnitPrice }
    : null;
}

const actionButtonClass =
  "flex items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40";

export function CartLine({
  item,
  variant = "default",
  className,
  onQuantityChange,
  onDiscount,
  onRemove,
}: CartLineProps) {
  const isCompact = variant === "compact";
  const offer = cartLineOffer(item);
  const priceOverride = cartLinePriceOverride(item);
  const grossLineTotal = item.quantity * item.unitPrice;
  const lineTotal = grossLineTotal - item.discountAmount;
  const hasDiscount = item.discountAmount > 0;
  const atStockLimit = item.quantity >= item.availableStock;
  const originalUnitPrice = Number(item.originalUnitPrice);
  const showsOriginalUnitPrice =
    Number.isFinite(originalUnitPrice) &&
    Number(item.unitPrice) !== originalUnitPrice;

  return (
    <div
      className={cn(
        "@container flex gap-3 rounded-lg border border-border/70 bg-card p-2.5",
        isCompact && "gap-2 border-border/60 bg-muted/20 p-2",
        className,
      )}
    >
      {/* Full-height thumbnail: the image owns the whole left edge of the line
          in every desktop column wide enough to keep the money row intact. */}
      <div
        data-testid="cart-line-image"
        className={cn(
          "relative shrink-0 self-stretch overflow-hidden rounded-lg border border-border/50 bg-muted/50",
          isCompact
            ? "w-14"
            : "hidden w-20 @min-[19rem]:block @min-[24rem]:w-24 @min-[26rem]:w-28",
        )}
      >
        {item.product.imageUrl ? (
          <Image
            src={item.product.imageUrl}
            alt={item.product.name}
            fill
            sizes={isCompact ? "56px" : "96px"}
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package
              className={cn(
                "text-muted-foreground/45",
                isCompact ? "h-4 w-4" : "h-5 w-5",
              )}
            />
          </div>
        )}
      </div>

      {/* Two rows that fill the card: identity and actions on top, quantities
          and money at the bottom. */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "break-words font-semibold leading-snug text-foreground",
                isCompact
                  ? "line-clamp-1 text-[13px]"
                  : "line-clamp-2 text-[15px]",
              )}
            >
              {item.product.name}
            </p>

            {(offer || priceOverride) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {offer && (
                  <Badge
                    variant="danger"
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-xs"
                  >
                    Oferta -{offer.percent}%
                  </Badge>
                )}
                {priceOverride && (
                  <span data-testid="price-overridden" className="shrink-0">
                    <Badge
                      variant="warning"
                      className="rounded-md px-1.5 py-0.5 text-xs"
                    >
                      Precio ajustado
                    </Badge>
                  </span>
                )}
              </div>
            )}

            <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm tabular-nums text-muted-foreground">
              {showsOriginalUnitPrice && (
                <s
                  data-testid="original-unit-price"
                  className="text-[13px] text-muted-foreground/60 line-through"
                >
                  {formatCurrency(originalUnitPrice)}
                </s>
              )}
              <span
                data-testid="line-unit-price"
                className="whitespace-nowrap"
              >
                <span className="font-medium text-foreground/85">
                  {formatCurrency(item.unitPrice)}
                </span>{" "}
                <span className="text-muted-foreground/80">c/u</span>
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {/*
              Default lines use 32px targets inside a dense desktop column; the
              mobile drawer keeps 44px, the size a thumb needs next to the
              quantity stepper.
            */}
            <button
              type="button"
              onClick={() => onDiscount(item.productId)}
              className={cn(
                actionButtonClass,
                isCompact ? "h-11 w-11" : "h-8 w-8",
                hasDiscount
                  ? "bg-primary-light text-primary-text hover:bg-primary-light/80"
                  : "hover:bg-muted/70 hover:text-foreground active:bg-muted",
              )}
              title="Descuento"
              aria-label={`Descuento para ${item.product.name}`}
            >
              <Percent className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(item.productId)}
              className={cn(
                actionButtonClass,
                isCompact ? "h-11 w-11" : "h-8 w-8",
                "hover:bg-danger/10 hover:text-danger-text",
              )}
              title="Eliminar"
              aria-label={`Eliminar ${item.product.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* The saving shares the row with nothing: it has to fit beside an 80px
            tile, the stepper and the total on the narrowest desktop column. */}
        <div className="mt-auto space-y-0.5">
          {hasDiscount && (
            <div className="flex justify-end">
              <span
                data-testid="line-discount"
                className="whitespace-nowrap rounded-md bg-success/10 px-1.5 py-0.5 text-xs font-medium tabular-nums text-success-text"
              >
                Ahorro {formatCurrency(item.discountAmount)}
                {item.discountPercent ? ` · ${item.discountPercent}%` : ""}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Stepper
                value={item.quantity}
                min={1}
                max={item.availableStock}
                size={isCompact ? "md" : "sm"}
                className={
                  isCompact
                    ? "[&_input]:w-14 [&_input]:text-base"
                    : "[&_input]:w-8"
                }
                onChange={(value) => onQuantityChange(item.productId, value)}
              />
              {atStockLimit && (
                <span className="text-xs font-medium text-warning-text">
                  máx.
                </span>
              )}
            </div>

            {/* Struck subtotal, then the money the line actually adds. */}
            <div className="ml-auto flex shrink-0 flex-col items-end gap-0.5 text-right">
              {hasDiscount && (
                <s
                  data-testid="cart-line-gross"
                  className="text-xs leading-tight tabular-nums line-through text-muted-foreground"
                >
                  {formatCurrency(grossLineTotal)}
                </s>
              )}
              <p
                data-testid="cart-line-total"
                className={cn(
                  "whitespace-nowrap font-bold leading-tight tabular-nums text-foreground",
                  isCompact ? "text-base" : "text-lg @min-[26rem]:text-xl",
                )}
              >
                {formatCurrency(lineTotal)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
