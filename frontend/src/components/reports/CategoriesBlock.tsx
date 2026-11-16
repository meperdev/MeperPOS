"use client";

import { BarChart3 } from "lucide-react";
import { categoryShares } from "@/lib/reportPresentation";
import { formatCurrency } from "@/lib/utils";
import type { ReportEnvelope, SaleByCategory } from "@/types";
import { CHART_OTHER_COLOR, chartSeriesColor } from "./chartColors";
import { QuerySection, type ReportQuery } from "./QuerySection";

/**
 * One 100%-stacked bar plus a descending legend: the five biggest categories
 * and everything else as "Otras". A ranking of thin bars per category was
 * unreadable past the third row — the share of the total is the question here.
 */
export function CategoriesBlock({
  query,
}: {
  query: ReportQuery<ReportEnvelope<SaleByCategory[]>>;
}) {
  const shares = categoryShares(query.data?.data ?? []);

  return (
    <QuerySection
      query={query}
      title="Categorías"
      icon={BarChart3}
      loadingLabel="Cargando categorías…"
      loadingRows={5}
      loadingColumns={2}
      errorMessage="No se pudieron cargar categorías"
      isEmpty={shares.length === 0}
      emptyText="Sin ventas por categoría en el período."
    >
      <div className="space-y-3">
        <div
          role="img"
          aria-label="Mezcla de ventas por categoría"
          className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted"
        >
          {shares.map((slice, index) => (
            <div
              key={slice.label}
              title={`${slice.label}: ${slice.percentage}%`}
              style={{
                width: `${slice.share * 100}%`,
                backgroundColor:
                  slice.label === "Otras" ? CHART_OTHER_COLOR : chartSeriesColor(index),
              }}
            />
          ))}
        </div>

        <ul className="divide-y divide-border/40">
          {shares.map((slice, index) => {
            const color =
              slice.label === "Otras" ? CHART_OTHER_COLOR : chartSeriesColor(index);
            return (
              <li
                key={slice.label}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate text-xs text-foreground">{slice.label}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {slice.percentage}%
                  </span>
                  <span className="text-xs font-semibold text-foreground tabular-nums">
                    {formatCurrency(slice.total)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </QuerySection>
  );
}
