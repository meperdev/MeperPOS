"use client";

import { useTopSellingProducts } from "@/hooks/useReports";

/** The endpoint caps at five; the card never asks for more than it renders. */
const TOP_PRODUCTS_LIMIT = 5;

/**
 * Ranked list of the best-selling products for the selected window. The
 * `top-selling` endpoint returns no image, so this renders a text-only ranking:
 * rank, product name and quantity sold.
 */
export function TopProductsCard({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const { data } = useTopSellingProducts(startDate, endDate, TOP_PRODUCTS_LIMIT);
  const products = (data?.data ?? []).slice(0, TOP_PRODUCTS_LIMIT);

  return (
    <div
      data-testid="top-products-card"
      className="flex h-full min-h-0 flex-col"
    >
      <p className="text-sm font-semibold tracking-tight text-foreground">
        Top productos
      </p>

      {products.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Sin ventas en el período
        </p>
      ) : (
        <ol className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-hidden">
          {products.map((product, index) => (
            <li
              key={product.productId}
              data-testid="top-product-row"
              className="flex items-center gap-2.5 text-xs"
            >
              <span
                data-testid="top-product-rank"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 font-mono text-[11px] font-semibold text-muted-foreground tabular-nums"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {product.productName}
              </span>
              <span className="shrink-0 font-mono text-[11px] font-semibold text-foreground tabular-nums">
                <span data-testid="top-product-quantity">{product.quantity}</span>
                <span className="ml-1 font-sans font-normal text-muted-foreground">
                  u
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
