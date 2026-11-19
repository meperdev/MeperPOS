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
  inactive: "border-border bg-card/90 text-muted-foreground",
  service: "border-info/30 bg-card/90 text-info-text",
  untracked: "border-info/30 bg-card/90 text-info-text",
  depleted: "border-danger/30 bg-card/90 text-danger-text",
  low: "border-warning/30 bg-card/90 text-warning-text",
  healthy: "border-success/30 bg-card/90 text-success-text",
};

/** The stock count sits on the dark scrim with a subtle semantic tint. */
const STOCK_TONE: Partial<Record<StatusKey, string>> = {
  healthy: "border-success/30 bg-success/15 text-success-text",
  low: "border-warning/35 bg-warning/15 text-warning-text",
  depleted: "border-danger/35 bg-danger/15 text-danger-text",
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
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium leading-none sm:text-[13px]",
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
    <span className="inline-flex max-w-full items-center whitespace-nowrap rounded-md border border-danger/30 bg-card/90 px-2 py-1 text-xs font-medium leading-none tabular-nums text-danger-text sm:text-[13px]">
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
function ProductMedia({ product, hideOnPhone }: { product: ProductCardData; hideOnPhone: boolean }) {
  return (
    <div
      data-testid="product-media"
      className={cn(
        "absolute inset-0 overflow-hidden rounded-[inherit] bg-muted",
        // No photo and no room for a well: a phone tile must not show a grey strip.
        hideOnPhone && "max-sm:hidden",
      )}
    >
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.name}
          fill
          sizes="(max-width: 640px) 33vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover"
        />
      ) : (
        <>
          <div className="absolute inset-0 rounded-[inherit] bg-muted" aria-hidden="true" />
          {/* Centred in the visible upper space above the content sheet. */}
          <div className="absolute inset-x-0 top-0 bottom-[8.25rem] flex items-center justify-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card/60">
              <Package className="h-5 w-5 stroke-[1.5] text-muted-foreground" aria-hidden="true" />
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
  compact = false,
  children,
}: {
  label: string;
  tone?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** A phone tile: keep the 44px target, shrink what it draws. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="group/rail flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground transition-colors",
          compact && "max-sm:h-6 max-sm:w-6",
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

  // The POS grid on a phone is a dense tile wall (nine tiles on a 390x844
  // screen), so the card trades its poster proportions for a short tile below
  // sm. Inventory keeps its poster at every width.
  const compactPos = !isInventory;
  // A phone tile with no photo has no media layer at all: the name panel becomes
  // the tile, so the card must not paint the muted backdrop or a divider over it.
  const barePhoneTile = compactPos && !product.imageUrl;

  return (
    <div
      className={cn(
        "group relative isolate flex w-full max-w-[22rem] aspect-[4/5] max-h-[22rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-muted shadow-2xs transition-colors duration-150 hover:border-primary/40",
        // Inventory is the short card: three rows of it have to fit a 1080p
        // viewport between the filters and the pager (see
        // PRODUCT_CARD_MIN_ROW_HEIGHT). POS keeps the taller poster.
        // From `lg` the inventory grid stretches every row to the height left above
        // the pager, so the card gives up its poster aspect and its height cap there
        // and takes the row's height. The photo is an edge-to-edge layer, so that
        // extra height becomes more photo; the sheet stays docked at the bottom.
        isInventory
          ? "min-h-[13.5rem] lg:h-full lg:aspect-auto lg:max-h-none"
          : "min-h-[15.5rem]",
        compactPos &&
          "max-sm:min-h-[7rem] max-sm:max-h-none max-sm:aspect-auto max-sm:max-w-none max-sm:rounded-xl",
        barePhoneTile && "max-sm:bg-card",
        isInactive && "opacity-60",
      )}
    >
      <ProductMedia product={product} hideOnPhone={barePhoneTile} />

      {/* The card overlay stays below independent management and favorite buttons. */}
      {onClick && (
        <button
          type="button"
          aria-label={isInventory ? `Editar producto: ${product.name}` : `Agregar al carrito: ${product.name}`}
          aria-disabled={isInventory ? undefined : cannotAdd}
          disabled={!isInventory && cannotAdd}
          onClick={onClick}
          // Press feedback is a colour wash, never a scale (D5).
          className="absolute inset-0 z-10 rounded-[inherit] transition-colors duration-150 active:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        />
      )}

      {/*
        Chips are click-through overlays parked top-left, over the lightest part of the photo.
        Being absolute they take no space, so no chip can ever reflow or resize the card.
        A phone tile is too small for them: the stock count keeps its tone and the offer
        moves into the name panel, clear of the favorite control.
      */}
      {(showStatusChip || hasPromo) && (
        <div
          className={cn(
            "pointer-events-none absolute left-2 top-2 z-20 flex max-w-[calc(100%-3.75rem)] flex-col items-start gap-1",
            compactPos && "max-sm:hidden",
          )}
        >
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
            // On a phone tile there is no photo corner to spare: the favourite moves to
            // the bottom row beside the price, where the price reserves its disc width.
            compactPos && "max-sm:top-auto max-sm:bottom-1.5 max-sm:right-1",
          )}
        >
          {!isInventory && onToggleFavorite && (
            <RailButton
              label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
              compact={compactPos}
              tone={
                isFavorite
                  ? "border-warning/60 bg-warning/35 text-warning-text"
                  : "group-hover/rail:text-foreground"
              }
              onClick={onToggleFavorite}
            >
              <Star
                className={cn(
                  "h-3.5 w-3.5",
                  isFavorite && "fill-current",
                  compactPos && "max-sm:h-3 max-sm:w-3",
                )}
                aria-hidden="true"
              />
            </RailButton>
          )}
          {isInventory && footerHandler && (
            <RailButton
              label={isInactive ? "Reactivar producto" : "Desactivar producto"}
              tone={
                isInactive
                  ? "group-hover/rail:bg-success/70 group-hover/rail:text-white"
                  : "group-hover/rail:bg-danger/70 group-hover/rail:text-white"
              }
              onClick={footerHandler}
            >
              {isInactive ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Power className="h-3.5 w-3.5" aria-hidden="true" />}
            </RailButton>
          )}
        </div>
      )}

      {/*
        The content block is a flat card-coloured panel docked to the bottom of the photo (no
        gradient, no blur), theme tokens only, so its text reads in both light and dark mode. It is the only in-flow child and
        a plain relative block, so the full-card click surface above it still receives every
        click on the name, meta and price.
      */}
      <div
        data-testid="product-sheet"
        className={cn(
          "relative mt-auto flex w-full min-w-0 flex-col border-t border-border bg-card px-3 text-foreground",
          // The inventory sheet is the tight one: a shorter card means less
          // photo band, not less information, so the padding gives a few pixels
          // back. POS keeps its roomier panel.
          isInventory ? "px-2.5 pb-2.5 pt-2.5" : "pb-3 pt-3",
          compactPos && "max-sm:px-2 max-sm:pb-1.5 max-sm:pt-1.5",
          // The tile starts at the sheet's own top edge: no strip above it, and
          // therefore no divider to mark one. The name, stock and price spread
          // over the tile's height so no dead band is left under the price.
          barePhoneTile && "max-sm:mt-0 max-sm:h-full max-sm:justify-between max-sm:border-t-0",
        )}
      >
        <h3
          className={cn(
            "line-clamp-2 min-h-[2.25rem] min-w-0 break-words text-sm font-semibold leading-snug text-foreground",
            // The inventory tile is the narrow one: at nine columns its name
            // column cannot afford the POS poster's 15px without clamping a
            // title that used to fit, so it stays on the body step.
            !isInventory && "sm:text-[15px]",
            compactPos && "max-sm:min-h-0 max-sm:text-[13px]",
          )}
        >
          {product.name}
        </h3>

        {(product.sku || showStock || (compactPos && hasPromo)) && (
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2 max-sm:mt-0.5 max-sm:flex-wrap">
            {product.sku && (
              <span
                className={cn(
                  "min-w-0 truncate id-text text-xs text-muted-foreground",
                  // The tile has room for the name, the price and the stock — not the SKU.
                  compactPos && "max-sm:hidden",
                )}
              >
                {product.sku}
              </span>
            )}
            {showStock && (
              <span
                data-testid="product-stock"
                className={cn(
                  "ml-auto shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium leading-none tabular-nums",
                  // On a phone tile the count is its own line, reading from the left.
                  compactPos && "max-sm:ml-0",
                  STOCK_TONE[status] ?? "border-border bg-muted text-foreground",
                )}
              >
                {product.stock} uds.
              </span>
            )}
            {compactPos && hasPromo && (
              // The overlay badge is gone on a phone tile; the discount keeps its
              // place at the end of the stock line and wraps instead of shrinking.
              <span
                data-testid="offer-compact"
                className="ml-auto hidden shrink-0 items-center rounded-md border border-danger/30 bg-danger/10 px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums text-danger-text max-sm:inline-flex"
              >
                -{discount}%
              </span>
            )}
          </div>
        )}

        <div
          data-testid="product-price-panel"
          className={cn(
            "min-w-0",
            product.sku || showStock ? "mt-2" : "mt-auto pt-2",
            compactPos && "max-sm:mt-1",
          )}
        >
          <span
            className={cn(
              "block w-fit max-w-full truncate rounded-md border border-primary/40 bg-primary/15 px-2 py-1 text-xs font-semibold leading-none text-primary-text",
              compactPos && "max-sm:hidden",
            )}
          >
            {categoryName}
          </span>
          {/* Wraps so the list price drops below the selling price instead of overflowing. */}
          <div
            data-testid="product-price-row"
            className={cn(
              "mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 max-sm:mt-0",
              // The bottom row of a phone tile: the price keeps the left, the favourite
              // disc sits at the right, and the row is tall enough to centre both.
              compactPos && "max-sm:min-h-11 max-sm:items-center max-sm:pr-8",
            )}
          >
            <span
              data-testid={hasPromo ? "offer-effective-price" : undefined}
              className="whitespace-nowrap text-xl font-semibold leading-none tabular-nums tracking-tight text-foreground max-sm:text-[13px]"
            >
              {formatCurrency(sellingPrice)}
            </span>
            {hasPromo && (
              <s
                data-testid="offer-list-price"
                className="whitespace-nowrap text-[13px] tabular-nums text-muted-foreground line-through"
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
