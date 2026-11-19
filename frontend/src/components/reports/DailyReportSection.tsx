"use client";

import Link from "next/link";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  HandCoins,
  PackageSearch,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { getApiErrorMessage } from "@/lib/api";
import {
  dailyReportPendingItems,
  dailyReportSalesRows,
  formatReportClockTime,
  formatReportDayLabel,
  formatReportMoney,
  type DailyReportPendingKey,
  type DailyReportPendingSeverity,
} from "@/lib/reportPresentation";
import { cn } from "@/lib/utils";
import type { DailyReport } from "@/types";
import { SectionShell } from "./SectionShell";

const PENDING_ICONS: Record<DailyReportPendingKey, LucideIcon> = {
  lowStock: PackageSearch,
  purchaseOrders: ClipboardList,
  loans: HandCoins,
};

const SEVERITY_DOT: Record<DailyReportPendingSeverity, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};

/**
 * One to three cards share the row; a fourth would be a grid of empty columns,
 * so the column count follows how many groups actually have work.
 */
const PENDING_GRID_COLUMNS: Record<number, string> = {
  1: "",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
};

/**
 * "Hoy": the payload the intelligence daily report sends, on screen.
 *
 * It always covers today in Bogotá, so it sits above the period filter and
 * says so in its own header. Every amount is formatted as the server sent it —
 * the pulse never re-adds sales or expenses in the browser.
 */
export function DailyReportSection({
  report,
  isLoading,
  error,
  onRetry,
  onRefresh,
  isRefreshing = false,
}: {
  report?: DailyReport;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}) {
  const [showSales, setShowSales] = useState(false);

  const salesRows = report ? dailyReportSalesRows(report.sales) : [];
  const pendingItems = report ? dailyReportPendingItems(report) : [];
  const pulse = report
    ? [
        { label: "Ventas del día", value: formatReportMoney(report.salesTotal) },
        { label: "Ventas registradas", value: String(report.sales.length) },
        { label: "Gastos del día", value: formatReportMoney(report.expenseTotal) },
        { label: "Último corte", value: formatReportClockTime(report.cutoff) },
      ]
    : [];

  return (
    <SectionShell
      title="Hoy"
      icon={CalendarClock}
      description={
        report ? (
          <>
            <span>{formatReportDayLabel(report.date)}</span>
            <span className="hidden md:inline"> · no depende del período</span>
          </>
        ) : null
      }
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          loading={isRefreshing}
          aria-label="Actualizar reporte del día"
        >
          {!isRefreshing && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          Actualizar
        </Button>
      }
    >
      {isLoading ? (
        <div aria-busy="true">
          <CardSkeleton
            count={4}
            label="Cargando reporte del día…"
            className="sm:grid-cols-2 xl:grid-cols-4"
            cardClassName="min-h-[72px]"
          />
        </div>
      ) : error ? (
        <ErrorState
          message={getApiErrorMessage(error, "No se pudo cargar el reporte del día")}
          onRetry={onRetry}
          retryLabel="Reintentar"
          className="min-h-[120px]"
        />
      ) : !report ? (
        <p className="py-1 text-[13px] text-muted-foreground">
          Todavía no hay datos para el reporte de hoy.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-4">
            {pulse.map((item) => (
              <div key={item.label} className="bg-card px-3 py-2.5">
                <p className="text-[13px] text-muted-foreground">{item.label}</p>
                <p className="mt-0.5 truncate text-lg font-semibold tracking-tight text-foreground tabular-nums">
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {pendingItems.length === 0 ? (
            <p className="border-t border-border/60 pt-2.5 text-[13px] text-muted-foreground">
              Sin pendientes para hoy: stock, órdenes de compra y préstamos al día.
            </p>
          ) : (
            <div
              data-pending-grid
              data-pending-count={pendingItems.length}
              className={cn(
                "grid gap-2 md:gap-3",
                PENDING_GRID_COLUMNS[Math.min(pendingItems.length, 3)],
              )}
            >
              {pendingItems.map((item) => {
                const Icon = PENDING_ICONS[item.key];
                return (
                  <article
                    key={item.key}
                    data-pending-group={item.key}
                    className="flex h-full flex-col rounded-lg border border-border/60 bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <Icon
                          className="mt-px h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <div className="flex min-w-0 items-baseline gap-1.5">
                          <span className="text-[13px] font-medium leading-snug text-foreground">
                            {item.label}
                          </span>
                          <span className="text-[13px] font-medium text-muted-foreground tabular-nums">
                            {item.count}
                          </span>
                        </div>
                      </div>
                      <Link
                        href={item.href}
                        className="-my-0.5 inline-flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        Ver
                        <ChevronRight className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </div>

                    <ul className="mt-2 space-y-1">
                      {item.chips.map((chip) => (
                        <li
                          key={chip.id}
                          data-pending-chip={chip.id}
                          className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1"
                        >
                          <span
                            data-severity={chip.severity}
                            aria-hidden="true"
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              SEVERITY_DOT[chip.severity],
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                            {chip.label}
                          </span>
                          <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                            {chip.value}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {item.remaining > 0 && (
                      <p className="mt-auto pt-1.5 text-[13px] text-muted-foreground">
                        +{item.remaining} más
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
            <p className="text-[13px] text-muted-foreground">
              Ventas de hoy{" "}
              <span className="font-medium text-foreground tabular-nums">
                {salesRows.length}
              </span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showSales}
              aria-controls="daily-report-sales"
              onClick={() => setShowSales((open) => !open)}
            >
              {showSales ? "Ocultar ventas" : "Ver ventas"}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-150",
                  showSales && "rotate-180",
                )}
                aria-hidden="true"
              />
            </Button>
          </div>

          <div id="daily-report-sales">
            {showSales &&
              (salesRows.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">Sin ventas registradas hoy.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <ul aria-label="Ventas de hoy" className="divide-y divide-border/50">
                    {salesRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-baseline justify-between gap-3 py-1.5"
                      >
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="shrink-0 text-[13px] font-medium text-muted-foreground tabular-nums">
                            #{row.saleNumber}
                          </span>
                          <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                            {row.time}
                          </span>
                          <span className="truncate text-sm text-foreground">
                            {row.customerLabel}
                          </span>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums">
                          {formatReportMoney(row.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </div>
      )}
    </SectionShell>
  );
}
