"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useDashboard, useDailySales } from "@/hooks/useReports";
import { useExpenses } from "@/hooks/useExpenses";
import {
  cn,
  formatCurrency,
  getBogotaDateInputValue,
  shiftDateInputValue,
} from "@/lib/utils";
import {
  buildDailyMetricSeries,
  buildDateWindow,
  computeDelta,
  computeTodayMetrics,
  sumExpensesOnDate,
} from "@/lib/dashboard";
import { MetricCard } from "@/components/ui/MetricCard";

/**
 * KPI window: the last 7 days ending today. Yesterday — the delta baseline —
 * already sits inside that window, so no extra day is needed.
 */
const WINDOW_DAYS = 7;
/** Sparkline length — the newest 7 days of the window. */
const SPARKLINE_DAYS = 7;

const LOW_STOCK_HREF = "/inventory?filter=lowStock";

export function TodayStats() {
  return <TodayStatsInner today={getBogotaDateInputValue()} />;
}

export function TodayStatsInner({ today }: { today: string }) {
  const yesterday = useMemo(() => shiftDateInputValue(today, -1), [today]);
  const windowDays = useMemo(() => buildDateWindow(today, WINDOW_DAYS), [today]);
  const windowStart = windowDays[0] ?? today;

  const { data: dailySales } = useDailySales(windowStart, today);
  const { data: dashboard } = useDashboard();
  const todayMonth = useMemo(() => today.slice(0, 7), [today]);
  const { data: expensesResponse } = useExpenses({ month: todayMonth, limit: 100 });

  const salesRecords = dailySales?.data;
  const expenses = expensesResponse?.data;

  const todayMetrics = computeTodayMetrics(
    salesRecords?.find((entry) => entry.date === today),
  );
  const yesterdayMetrics = computeTodayMetrics(
    salesRecords?.find((entry) => entry.date === yesterday),
  );

  const expensesToday = sumExpensesOnDate(expenses, today);
  const expensesYesterday = sumExpensesOnDate(expenses, yesterday);

  const salesSeries = buildDailyMetricSeries(
    salesRecords,
    windowDays,
    (record) => record.total,
  ).slice(-SPARKLINE_DAYS);
  const transactionsSeries = buildDailyMetricSeries(
    salesRecords,
    windowDays,
    (record) => record.count,
  ).slice(-SPARKLINE_DAYS);
  const ticketSeries = buildDailyMetricSeries(
    salesRecords,
    windowDays,
    (record) => computeTodayMetrics(record).ticket,
  ).slice(-SPARKLINE_DAYS);
  const expensesSeries = windowDays
    .map((day) => sumExpensesOnDate(expenses, day))
    .slice(-SPARKLINE_DAYS);

  const lowStockCount = dashboard?.lowStockProducts ?? 0;
  const lowStockLabel = lowStockCount === 1
    ? "1 producto"
    : `${lowStockCount.toLocaleString("es-CO")} productos`;
  const totals = [
    {
      label: "Ventas completadas",
      value: (dashboard?.totalSales ?? 0).toLocaleString("es-CO"),
    },
    {
      label: "Productos totales",
      value: (dashboard?.totalProducts ?? 0).toLocaleString("es-CO"),
    },
    {
      label: "Clientes totales",
      value: (dashboard?.totalCustomers ?? 0).toLocaleString("es-CO"),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Today's KPIs — sparkline + real delta vs yesterday */}
      <div
        data-testid="kpi-row-1"
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        <MetricCard
          label="Ventas hoy"
          value={formatCurrency(todayMetrics.sales)}
          helper="del día"
          tone="green"
          sparkline={salesSeries}
          delta={computeDelta(todayMetrics.sales, yesterdayMetrics.sales)}
        />
        <MetricCard
          label="Salidas hoy"
          value={formatCurrency(expensesToday)}
          helper="gastos"
          tone="rose"
          sparkline={expensesSeries}
          delta={computeDelta(expensesToday, expensesYesterday)}
        />
        <MetricCard
          label="Transacciones"
          value={String(todayMetrics.transactions)}
          helper="hoy"
          tone="accent"
          sparkline={transactionsSeries}
          delta={computeDelta(todayMetrics.transactions, yesterdayMetrics.transactions)}
        />
        <MetricCard
          label="Ticket promedio"
          value={formatCurrency(todayMetrics.ticket)}
          helper="por venta"
          tone="blue"
          sparkline={ticketSeries}
          delta={computeDelta(todayMetrics.ticket, yesterdayMetrics.ticket)}
        />
      </div>

      {/* All-time totals — one compact card, three divided cells, no sparkline
          and no footer. Three columns hold at every width, mobile included.
          Low stock is a condition to act on, so it joins as a fourth cell that
          is a link (a full row below md), and disappears when nothing needs reordering. */}
      <section
        data-testid="kpi-totals"
        aria-label="Totales"
        className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs"
      >
        <div className={cn("grid grid-cols-3", lowStockCount > 0 && "md:grid-cols-4")}>
          {totals.map((total, index) => (
            <div key={total.label} className={cn("flex min-w-0 flex-col px-3 py-3", index > 0 && "border-l border-border")}>
              <p className="text-xs font-medium text-muted-foreground">
                {total.label}
              </p>
              {/* `mt-auto` keeps the three values on one baseline when a label
                  wraps to two lines and its neighbours do not (390px). */}
              <p
                className="mt-auto pt-1 truncate text-lg font-semibold text-foreground tabular-nums"
                title={total.value}
              >
                {total.value}
              </p>
            </div>
          ))}
          {lowStockCount > 0 && (
            <Link
              href={LOW_STOCK_HREF}
              data-testid="kpi-low-stock"
              aria-label={`${lowStockLabel} en stock crítico, reordenar`}
              className="group col-span-3 flex min-w-0 items-center justify-between gap-3 border-t border-border bg-danger/10 px-3 py-3 text-danger-text transition-colors hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 md:col-span-1 md:border-l md:border-t-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-xs font-medium">Stock crítico</span>
                <span className="mt-auto truncate pt-1 text-lg font-semibold tabular-nums">
                  {lowStockLabel}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
              />
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
