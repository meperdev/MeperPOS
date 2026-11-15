"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
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

export function TodayStats() {
  return <TodayStatsInner today={getBogotaDateInputValue()} />;
}

export function TodayStatsInner({ today }: { today: string }) {
  const router = useRouter();
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

  return (
    <div className="space-y-3">
      {/* Row 1 — day KPIs with sparkline + real delta vs yesterday */}
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

      {/* Row 2 — accumulated totals, no sparkline and no delta */}
      <div
        data-testid="kpi-row-2"
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        <MetricCard
          label="Ventas completadas"
          value={(dashboard?.totalSales ?? 0).toLocaleString("es-CO")}
          helper="acumulado"
          tone="primary"
        />
        <MetricCard
          label="Productos totales"
          value={(dashboard?.totalProducts ?? 0).toLocaleString("es-CO")}
          helper="catálogo"
          tone="primary"
        />
        <MetricCard
          label="Clientes totales"
          value={(dashboard?.totalCustomers ?? 0).toLocaleString("es-CO")}
          helper="registrados"
          tone="blue"
        />
        <MetricCard
          label="Stock crítico"
          value={String(dashboard?.lowStockProducts ?? 0)}
          helper="por reordenar"
          tone="rose"
          action={{
            label: "Reordenar",
            onClick: () => router.push("/inventory?filter=lowStock"),
          }}
        />
      </div>
    </div>
  );
}
