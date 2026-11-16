"use client";

import { Package } from "lucide-react";
import { formatReportMoney } from "@/lib/reportPresentation";
import type { InventorySnapshotReport } from "@/types";
import { QuerySection, type ReportQuery } from "./QuerySection";

/**
 * What the stock is worth today. Four figures on one strip — the same shape as
 * the cash figures above — instead of two half-width rows that read as two
 * answers.
 */
export function InventoryBlock({
  query,
  className,
}: {
  query: ReportQuery<InventorySnapshotReport>;
  className?: string;
}) {
  const current = query.data?.current;
  const figures = [
    { label: "Lo que costó tu inventario", value: formatReportMoney(current?.stockValue) },
    { label: "Lo que vale si vendes todo", value: formatReportMoney(current?.retailValue) },
    {
      label: "Ganancia posible",
      value: formatReportMoney(current?.potentialProfit),
      tone: "success" as const,
    },
    {
      label: "Unidades en stock",
      value: (current?.stockQuantity ?? 0).toLocaleString("es-CO"),
    },
  ];

  return (
    <QuerySection
      query={query}
      title="Inventario actual"
      icon={Package}
      loadingLabel="Cargando inventario…"
      loadingRows={2}
      loadingColumns={4}
      errorMessage="No se pudo cargar inventario"
      isEmpty={!current}
      emptyText="Sin inventario registrado."
      className={className}
    >
      <div
        data-stat-strip="inventory"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-4"
      >
        {figures.map((figure) => (
          <div key={figure.label} className="bg-card px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">{figure.label}</p>
            <p
              className={
                figure.tone === "success"
                  ? "mt-1 truncate text-base font-semibold tracking-tight text-success-text tabular-nums"
                  : "mt-1 truncate text-base font-semibold tracking-tight text-foreground tabular-nums"
              }
            >
              {figure.value}
            </p>
          </div>
        ))}
      </div>
    </QuerySection>
  );
}
