"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useDashboard, useDailySales } from "@/hooks/useReports";
import { useExpenses } from "@/hooks/useExpenses";
import {
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

      {/* Low stock is a condition to act on, not a metric to read: the whole
          strip is the link, and it disappears when there is nothing to reorder. */}
      {lowStockCount > 0 && (
        <Link
          href={LOW_STOCK_HREF}
          data-testid="kpi-low-stock"
          className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-danger-text transition-colors hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <span className="min-w-0 text-sm font-medium tabular-nums">
            {lowStockCount === 1
              ? "1 producto en stock crítico"
              : `${lowStockCount.toLocaleString("es-CO")} productos en stock crítico`}
          </span>
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold"
          >
            Reordenar
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}

      {/* All-time totals — one compact card, three divided cells, no sparkline
          and no footer. Three columns hold at every width, mobile included. */}
      <section
        data-testid="kpi-totals"
        aria-label="Totales"
        className="rounded-xl border border-border/70 bg-card shadow-2xs"
      >
        <div className="grid grid-cols-3 divide-x divide-border">
          {totals.map((total) => (
            <div key={total.label} className="flex min-w-0 flex-col px-3 py-3">
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
        </div>
      </section>
    </div>
  );
}
