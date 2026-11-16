"use client";

import { TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { ReportEnvelope, TopSellingProduct } from "@/types";
import { QuerySection, type ReportQuery } from "./QuerySection";

/**
 * The ranked bar list: one row per product, the bar is its share of the best
 * seller, the figures are quantity and revenue. Ranking, nothing else.
 */
export function TopProductsBlock({
  query,
  className,
}: {
  query: ReportQuery<ReportEnvelope<TopSellingProduct[]>>;
  className?: string;
}) {
  const products = query.data?.data ?? [];
  const maxTotal = Math.max(...products.map((product) => product.total || 0), 1);

  return (
    <QuerySection
      query={query}
      title="Productos más vendidos"
      icon={TrendingUp}
      loadingLabel="Cargando productos…"
      loadingRows={5}
      loadingColumns={2}
      errorMessage="No se pudieron cargar productos"
      isEmpty={products.length === 0}
      emptyText="Sin productos vendidos en el período."
      className={className}
    >
      <div className="space-y-2">
        {products.map((product, index) => (
          <div key={product.productId} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card text-[11px] font-semibold text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="truncate text-xs font-medium text-foreground sm:text-sm">
                  {product.productName}
                </span>
              </div>
              <div className="flex shrink-0 items-baseline gap-2">
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {product.quantity} vendidos
                </span>
                <span className="text-xs font-semibold text-foreground tabular-nums">
                  {formatCurrency(product.total)}
                </span>
              </div>
            </div>
            <div className="h-1 overflow-hidden rounded-sm bg-muted">
              <div
                className="h-full rounded-sm bg-foreground/70"
                style={{
                  width: `${Math.max(3, ((product.total || 0) / maxTotal) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </QuerySection>
  );
}
