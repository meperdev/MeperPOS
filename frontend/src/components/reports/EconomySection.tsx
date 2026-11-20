"use client";

import { CircleDollarSign, Info } from "lucide-react";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { MetricCard } from "@/components/ui/MetricCard";
import { getApiErrorMessage } from "@/lib/api";
import {
  adaptiveReportGranularity,
  formatReportMoney,
  safeDecimalNumber,
} from "@/lib/reportPresentation";
import { cn } from "@/lib/utils";
import type { AppliedRange, FinancialOverview, FinancialReport } from "@/types";
import { BlockNote, type ReportQuery } from "./QuerySection";
import { SectionShell } from "./SectionShell";

function formatRange(range?: AppliedRange) {
  if (!range?.startDate && !range?.endDate) return "Período completo";
  const format = (value: string | null) => {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "America/Bogota",
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  };
  const start = format(range.startDate);
  const end = format(range.endDate);
  return start && end ? `${start} - ${end}` : start ? `Desde ${start}` : `Hasta ${end}`;
}

function NarrativeSummary({ report }: { report: FinancialReport }) {
  const totalSold = safeDecimalNumber(report.netIncome);
  const expenses = safeDecimalNumber(report.operatingExpenses);
  const realProfit = safeDecimalNumber(report.netProfit);

  let message = "";
  let dotClass = "bg-muted-foreground/50";
  if (totalSold === 0 && expenses === 0) {
    message = "No hubo ventas ni gastos registrados en este período.";
  } else if (totalSold === 0) {
    message = `No hubo ventas en este período. Tuviste ${formatReportMoney(expenses)} en gastos.`;
    dotClass = "bg-warning";
  } else if (realProfit > 0) {
    message = `En este período vendiste ${formatReportMoney(totalSold)}. Te quedaron ${formatReportMoney(realProfit)} de ganancia después de ${formatReportMoney(expenses)} en gastos.`;
    dotClass = "bg-success";
  } else if (realProfit === 0) {
    message = `En este período vendiste ${formatReportMoney(totalSold)}. Quedaste en punto de equilibrio después de ${formatReportMoney(expenses)} en gastos.`;
  } else {
    message = `En este período vendiste ${formatReportMoney(totalSold)}. Estás con un balance negativo de ${formatReportMoney(Math.abs(realProfit))} después de ${formatReportMoney(expenses)} en gastos.`;
    dotClass = "bg-danger";
  }

  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg bg-muted/40 px-3.5 py-2.5">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
      <p className="text-[13px] font-medium leading-relaxed text-foreground tabular-nums">
        {message}
      </p>
    </div>
  );
}

/**
 * The reconciliation itself. It starts from the revenue the profit lines were
 * computed from (`attributableRevenue`), not from `netIncome`, so every line
 * subtracts exactly once and the numbers add up instead of drifting apart.
 */
function BreakdownCard({ report }: { report: FinancialReport }) {
  const attributableRevenue = safeDecimalNumber(report.attributableRevenue);
  const productCost = safeDecimalNumber(report.cogs);
  const grossProfit = safeDecimalNumber(report.grossProfit);
  const expenses = safeDecimalNumber(report.operatingExpenses);
  const realProfit = safeDecimalNumber(report.netProfit);
  const excludedItems = report.dataQuality.excludedItems;

  return (
    <div className="rounded-lg bg-muted/40 p-4">
      <div>
        <p className="text-[13px] font-semibold text-foreground sm:text-sm">Desglose</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">El camino de tu plata</p>
      </div>

      <div className="mt-3 space-y-2 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Ventas con costo conocido</span>
          <span className="font-semibold text-foreground tabular-nums">
            {formatReportMoney(attributableRevenue)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 text-danger-text">
          <span>(-) Costo de productos</span>
          <span className="font-semibold tabular-nums">
            -{formatReportMoney(productCost)}
          </span>
        </div>

        <div className="border-t border-border/60" />

        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Ganancia antes de gastos</span>
          <span className="font-semibold text-foreground tabular-nums">
            {formatReportMoney(grossProfit)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 text-danger-text">
          <span>(-) Gastos</span>
          <span className="font-semibold tabular-nums">
            -{formatReportMoney(expenses)}
          </span>
        </div>

        <div className="border-t border-border/60" />

        <div className="flex items-center justify-between gap-3 pt-0.5">
          <span className="font-semibold text-foreground">Ganancia real</span>
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              realProfit >= 0 ? "text-success-text" : "text-danger-text",
            )}
          >
            {formatReportMoney(realProfit)}
          </span>
        </div>
      </div>

      {excludedItems > 0 && (
        <p className="mt-3 border-t border-border/60 pt-2 text-[13px] text-muted-foreground tabular-nums">
          {excludedItems} registro{excludedItems === 1 ? "" : "s"} sin costo registrado
          queda{excludedItems === 1 ? "" : "n"} fuera de este desglose.
        </p>
      )}
    </div>
  );
}

function ComparisonChart({
  current,
  previous,
  range,
  comparisonRange,
}: {
  current: FinancialReport;
  previous: FinancialReport;
  range: AppliedRange;
  comparisonRange?: AppliedRange;
}) {
  const granularity = adaptiveReportGranularity(range.startDate, range.endDate);
  const metrics = [
    {
      label: "Actual",
      sublabel: formatRange(range),
      value: safeDecimalNumber(current.netIncome),
      color: "bg-foreground/85",
    },
    {
      label: "Anterior",
      sublabel: comparisonRange ? formatRange(comparisonRange) : "Período previo",
      value: safeDecimalNumber(previous.netIncome),
      color: "bg-muted-foreground/45",
    },
  ];
  const scale = Math.max(...metrics.map((metric) => Math.abs(metric.value)), 1);
  const currentProfit = safeDecimalNumber(current.netProfit);
  const previousProfit = safeDecimalNumber(previous.netProfit);
  const currentExpenses = safeDecimalNumber(current.operatingExpenses);
  const previousExpenses = safeDecimalNumber(previous.operatingExpenses);

  return (
    <div
      className="space-y-4"
      aria-label={`Comparación económica por ${granularity === "day" ? "día" : "mes"}`}
      role="img"
    >
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-semibold text-foreground sm:text-sm">
              Comparación con período anterior
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Comparando el total vendido entre ambos períodos
            </p>
          </div>
          <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
            Granularidad: {granularity === "day" ? "día" : "mes"}
          </span>
        </div>
        <div className="space-y-2">
          {metrics.map((item) => (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-foreground">
                  {item.label}{" "}
                  <span className="text-[13px] font-normal text-muted-foreground tabular-nums">
                    ({item.sublabel})
                  </span>
                </span>
                <span className="font-semibold text-foreground tabular-nums">
                  {formatReportMoney(item.value)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-sm bg-muted/60">
                <div
                  className={cn("h-full rounded-sm", item.color)}
                  style={{
                    width: `${Math.max(2, (Math.abs(item.value) / scale) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-3 text-[13px]">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <span className="block text-[13px] text-muted-foreground">
            Ganancia anterior
          </span>
          <span className="mt-0.5 block text-[13px] font-semibold text-foreground tabular-nums">
            {formatReportMoney(previousProfit)}
          </span>
          <span className="text-[13px] text-muted-foreground tabular-nums">
            Actual: {formatReportMoney(currentProfit)}
          </span>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <span className="block text-[13px] text-muted-foreground">
            Gastos anteriores
          </span>
          <span className="mt-0.5 block text-[13px] font-semibold text-foreground tabular-nums">
            {formatReportMoney(previousExpenses)}
          </span>
          <span className="text-[13px] text-muted-foreground tabular-nums">
            Actual: {formatReportMoney(currentExpenses)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Economía: the money answer for the period. The KPI row is the summary, the
 * comparison and the breakdown explain it, and the quality note names what the
 * profit leaves out.
 */
export function EconomySection({ query }: { query: ReportQuery<FinancialOverview> }) {
  const overview = query.data;
  const current = overview?.current;

  return (
    <SectionShell title="Economía" icon={CircleDollarSign}>
      {query.isLoading ? (
        <div aria-busy="true">
          <CardSkeleton
            count={4}
            label="Cargando economía…"
            className="sm:grid-cols-2 xl:grid-cols-4"
            cardClassName="min-h-[96px]"
          />
        </div>
      ) : query.error ? (
        <ErrorState
          message={getApiErrorMessage(
            query.error,
            "No se pudo cargar el resumen económico",
          )}
          onRetry={() => query.refetch()}
          retryLabel="Reintentar"
          className="min-h-[140px]"
        />
      ) : !current || !overview ? (
        <BlockNote>Sin datos de economía en el período.</BlockNote>
      ) : (
        <>
          <NarrativeSummary report={current} />
          <div className="grid gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-4">
            <MetricCard
              label="Total vendido"
              value={formatReportMoney(current.netIncome)}
              helper="Lo que entró por ventas"
              delta={overview.deltas.netIncome}
            />
            <MetricCard
              label="Ganancia antes de gastos"
              value={formatReportMoney(current.grossProfit)}
              helper={`${current.grossMarginPercentage?.toFixed(1) ?? "-"}% de margen sobre ventas`}
              delta={overview.deltas.grossProfit}
            />
            <MetricCard
              label="Ganancia real"
              value={formatReportMoney(current.netProfit)}
              helper={`${current.netMarginPercentage?.toFixed(1) ?? "-"}% de margen neto`}
              delta={overview.deltas.netProfit}
            />
            <MetricCard
              label="Gastos"
              value={formatReportMoney(current.operatingExpenses)}
              helper="Lo que pagas para que funcione el negocio"
              delta={overview.deltas.operatingExpenses}
            />
          </div>
          {current.dataQuality.excludedItems > 0 && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-warning-text"
                aria-hidden="true"
              />
              <p role="status" className="text-[13px] text-warning-text tabular-nums">
                <span className="font-semibold">
                  {current.dataQuality.snapshotBackedItems} registros con costo exacto
                </span>
                .{" "}
                <span>
                  {current.dataQuality.excludedItems} registro
                  {current.dataQuality.excludedItems === 1 ? "" : "s"} excluido
                  {current.dataQuality.excludedItems === 1 ? "" : "s"} de la ganancia; no se
                  estimó su costo actual.
                </span>
              </p>
            </div>
          )}
          <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <ComparisonChart
              current={current}
              previous={overview.previous}
              range={overview.appliedRange}
              comparisonRange={overview.comparisonRange}
            />
            <BreakdownCard report={current} />
          </div>
        </>
      )}
    </SectionShell>
  );
}
