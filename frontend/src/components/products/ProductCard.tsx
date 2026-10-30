"use client";

import Image from "next/image";
import { cn, formatCurrency } from "@/lib/utils";
import { isService, tracksStock } from "@/lib/product-type";
import { AlertTriangle, Package, Power, RotateCcw, Star, Wrench } from "lucide-react";

type ProductCardData = {
  id: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  stock: number;
  salePrice: number;
  costPrice?: number;
  type?: string | null;
  tracksStock?: boolean | null;
  category?: { name: string } | null;
  active?: boolean;
  /** Active promotion — when present, effectiveSalePrice is the selling price */
  promotionType?: string | null;
  promotionValue?: number | null;
  effectiveSalePrice?: number | null;
  /** Backend-computed low-stock flag; the client must not re-derive it. */
  isLowStock?: boolean;
};

interface ProductCardProps {
  product: ProductCardData;
  mode: "pos" | "inventory";
  onClick?: () => void;
  onDelete?: () => void;
  onReactivate?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

type StatusKey = "inactive" | "service" | "untracked" | "depleted" | "low" | "healthy";

const STATUS_LABEL: Record<StatusKey, string> = {
  inactive: "Inactivo",
  service: "Servicio",
  untracked: "Sin inventario",
  depleted: "Agotado",
  low: "Stock bajo",
  healthy: "Activo",
};

/**
 * Chips sit over the photo, so each tone is a near-solid light/dark plate with coloured
 * text: a translucent tint would take on whatever the photo shows underneath it.
 */
const STATUS_TONE: Record<StatusKey, string> = {
  inactive: "border-zinc-300 bg-white/90 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-300",
  service: "border-indigo-300 bg-white/90 text-indigo-700 dark:border-indigo-500/50 dark:bg-zinc-900/90 dark:text-indigo-300",
  untracked: "border-indigo-300 bg-white/90 text-indigo-700 dark:border-indigo-500/50 dark:bg-zinc-900/90 dark:text-indigo-300",
  depleted: "border-rose-300 bg-white/90 text-rose-700 dark:border-rose-500/50 dark:bg-zinc-900/90 dark:text-rose-300",
  low: "border-amber-300 bg-white/90 text-amber-800 dark:border-amber-500/50 dark:bg-zinc-900/90 dark:text-amber-300",
  healthy: "border-emerald-300 bg-white/90 text-emerald-700 dark:border-emerald-500/50 dark:bg-zinc-900/90 dark:text-emerald-300",
};

/** The stock count sits on the dark scrim with a subtle semantic tint. */
const STOCK_TONE: Partial<Record<StatusKey, string>> = {
  healthy: "border-emerald-500/30 bg-emerald-500/12 text-white/85",
  low: "border-amber-500/35 bg-amber-500/15 text-amber-300",
  depleted: "border-rose-500/35 bg-rose-500/15 text-rose-300",
};

/**
 * The single status chain. Deactivation and service type both outrank stock facts:
 * a service is sold labour that can never be depleted, and an untracked good is real
 * merchandise nobody counts, so neither may read as "Agotado".
 */
function resolveStatus(product: ProductCardData, isInactive: boolean): StatusKey {
  if (isInactive) return "inactive";
  if (isService(product)) return "service";
  if (!tracksStock(product)) return "untracked";
  if (product.stock === 0) return "depleted";
  // The flag is the server's answer (see backend isLowStock): an untracked item is never low
  // on stock whatever its stored numbers say, so re-deriving it here could only drift.
  return product.isLowStock === true ? "low" : "healthy";
}

function statusTestId(status: StatusKey): string | undefined {
  if (status === "service") return "service-chip";
  if (status === "untracked") return "untracked-chip";
  if (status === "depleted" || status === "low") return "stock-alert-icon";
  return undefined;
}

function StatusChip({ status }: { status: StatusKey }) {
  return (
    <span
      data-testid={statusTestId(status)}
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[11px] font-medium leading-none sm:text-xs",
        STATUS_TONE[status],
      )}
    >
      {status === "service" ? (
        <Wrench className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      ) : status === "depleted" || status === "low" ? (
        <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

function OfferBadge({ discount }: { discount: number }) {
  return (
    <span className="inline-flex max-w-full items-center whitespace-nowrap rounded-md border border-rose-300 bg-white/90 px-2 py-1 font-mono text-[11px] font-medium leading-none text-rose-700 dark:border-rose-500/50 dark:bg-zinc-900/90 dark:text-rose-300 sm:text-xs">
      Oferta{discount > 0 ? ` -${discount}%` : ""}
    </span>
  );
}

/**
 * Full-bleed media layer: the photo IS the card, not a framed thumbnail inside it.
 * Absolute, so the card's fixed shape (not the content) decides how much photo shows.
 * Every layer inherits the card radius and none uses a backdrop filter: a backdrop-blur
 * under overflow-hidden + a rounded corner + a hover transform leaves a grey wedge in
 * the corner, so nothing in the card blurs or fades: the info panel is a flat tint.
 */
function ProductMedia({ product }: { product: ProductCardData }) {
  return (
    <div data-testid="product-media" className="absolute inset-0 overflow-hidden rounded-[inherit] bg-zinc-900">
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.name}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
        />
      ) : (
        <>
          <div className="absolute inset-0 rounded-[inherit] bg-zinc-800 dark:bg-zinc-900" aria-hidden="true" />
          {/* Centred in the visible upper space above the content sheet. */}
          <div className="absolute inset-x-0 top-0 bottom-[8.25rem] flex items-center justify-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.03]">
              <Package className="h-5 w-5 stroke-[1.5] text-zinc-500" aria-hidden="true" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One quiet control in the card's top-right rail: a 44px hit target wrapping a small,
 * flat disc, so management and cart controls never become a heavy toolbar.
 */
function RailButton({
  label,
  tone,
  onClick,
  disabled,
  children,
}: {
  label: string;
  tone?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="group/rail flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition-colors",
          tone,
        )}
      >
        {children}
      </span>
    </button>
  );
}

export function ProductCard({ product, mode, onClick, onDelete, onReactivate, isFavorite = false, onToggleFavorite }: ProductCardProps) {
  const isInactive = product.active === false;
  const cannotAdd = isInactive || (tracksStock(product) && product.stock <= 0);
  const isInventory = mode === "inventory";
  const footerHandler = isInactive ? onReactivate : onDelete;
  const status = resolveStatus(product, isInactive);

  const hasPromo =
    typeof product.effectiveSalePrice === "number" &&
    Number(product.effectiveSalePrice) !== Number(product.salePrice);
  const discount =
    hasPromo && Number(product.salePrice) > 0
      ? Math.max(0, Math.round(100 - (Number(product.effectiveSalePrice) / Number(product.salePrice)) * 100))
      : 0;
  const sellingPrice = Number(hasPromo ? product.effectiveSalePrice : product.salePrice);

  // Only counted goods carry a stock figure: a service or an untracked good already says so in its chip.
  const showStock = tracksStock(product);
  const categoryName = product.category?.name || (isInventory ? "Sin categoría" : "General");
  // The healthy chip is inventory-only: on the POS floor "everything is fine" is pure noise.
  const showStatusChip = status !== "healthy" || isInventory;
  // Inventory edits through the full-card button, so its rail holds deactivation alone;
  // POS adds through the full-card button, so its rail holds favorite alone.
  const railVisible = isInventory ? Boolean(footerHandler) : Boolean(onToggleFavorite);

  return (
    <div
      className={cn(
        "group relative isolate flex w-full max-w-[22rem] aspect-[4/5] max-h-[22rem] min-h-[15.5rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-zinc-900 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-500/60 hover:shadow-lg",
        isInactive && "opacity-60",
      )}
    >
      <ProductMedia product={product} />

      {/* The card overlay stays below independent management and favorite buttons. */}
      {onClick && (
        <button
          type="button"
          aria-label={isInventory ? `Editar producto: ${product.name}` : `Agregar al carrito: ${product.name}`}
          aria-disabled={isInventory ? undefined : cannotAdd}
          disabled={!isInventory && cannotAdd}
          onClick={onClick}
          className="absolute inset-0 z-10 rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        />
      )}

      {/*
        Chips are click-through overlays parked top-left, over the lightest part of the photo.
        Being absolute they take no space, so no chip can ever reflow or resize the card.
      */}
      {(showStatusChip || hasPromo) && (
        <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[calc(100%-3.75rem)] flex-col items-start gap-1">
          {showStatusChip && <StatusChip status={status} />}
          {hasPromo && <OfferBadge discount={discount} />}
        </div>
      )}

      {/* Controls live in one corner of the photo, never over its subject. */}
      {railVisible && (
        <div
          className={cn(
            "absolute right-1.5 top-1.5 z-20 flex flex-col items-center",
            // Pointer devices reveal the management control on hover/focus; touch always shows it.
            isInventory &&
              "transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
          )}
        >
          {!isInventory && onToggleFavorite && (
            <RailButton
              label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
              tone={
                isFavorite
                  ? "border-amber-300/70 bg-amber-400/30 text-amber-100"
                  : "group-hover/rail:bg-black/55 group-hover/rail:text-amber-300"
              }
              onClick={onToggleFavorite}
            >
              <Star className={cn("h-3.5 w-3.5", isFavorite && "fill-current")} aria-hidden="true" />
            </RailButton>
          )}
          {isInventory && footerHandler && (
            <RailButton
              label={isInactive ? "Reactivar producto" : "Desactivar producto"}
              tone={isInactive ? "group-hover/rail:bg-emerald-600/70" : "group-hover/rail:bg-rose-600/70"}
              onClick={footerHandler}
            >
              {isInactive ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Power className="h-3.5 w-3.5" aria-hidden="true" />}
            </RailButton>
          )}
        </div>
      )}

      {/*
        The content block is a flat dark panel docked to the bottom of the photo (no gradient,
        no blur), so white text stays readable on any picture. It is the only in-flow child and
        a plain relative block, so the full-card click surface above it still receives every
        click on the name, meta and price.
      */}
      <div
        data-testid="product-sheet"
        className="relative mt-auto flex w-full min-w-0 flex-col border-t border-white/10 bg-zinc-950/80 px-3 pb-3 pt-3"
      >
        <h3 className="line-clamp-2 min-h-[2.25rem] min-w-0 break-words text-sm sm:text-[15px] font-semibold leading-snug text-white">
          {product.name}
        </h3>

        {(product.sku || showStock) && (
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
            {product.sku && (
              <span className="min-w-0 truncate font-mono text-[11px] text-white/60">{product.sku}</span>
            )}
            {showStock && (
              <span
                data-testid="product-stock"
                className={cn(
                  "ml-auto shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs font-medium leading-none tabular-nums",
                  STOCK_TONE[status] ?? "border-white/10 bg-white/[0.06] text-white/85",
                )}
              >
                {product.stock} uds.
              </span>
            )}
          </div>
        )}

        <div data-testid="product-price-panel" className={cn("min-w-0", product.sku || showStock ? "mt-2" : "mt-auto pt-2")}>
          <span className="block w-fit max-w-full truncate rounded-md border border-primary/50 bg-primary/25 px-2 py-1 font-mono text-[11px] font-semibold leading-none text-orange-200">
            {categoryName}
          </span>
          {/* Wraps so the list price drops below the selling price instead of overflowing. */}
          <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              data-testid={hasPromo ? "offer-effective-price" : undefined}
              className="whitespace-nowrap font-mono text-[1.375rem] font-extrabold leading-none tabular-nums tracking-tight text-white"
            >
              {formatCurrency(sellingPrice)}
            </span>
            {hasPromo && (
              <s
                data-testid="offer-list-price"
                className="whitespace-nowrap font-mono text-xs text-white/60 line-through"
              >
                {formatCurrency(Number(product.salePrice))}
              </s>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
