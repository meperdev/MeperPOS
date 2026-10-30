"use client";

import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useCashFlow,
  useCustomerStatistics,
  useEconomicOverview,
  useInventorySnapshot,
  useSalesByCategory,
  useSalesByPaymentMethod,
  useTopSellingProducts,
} from "@/hooks/useReports";
import { api, getApiErrorMessage } from "@/lib/api";
import { adaptiveReportGranularity, formatReportMoney, safeDecimalNumber } from "@/lib/reportPresentation";
import {
  cn,
  formatCurrency,
  formatPaymentMethod,
  getBogotaDateInputValue,
  shiftDateInputValue,
} from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  FilterClearButton,
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { MetricCard } from "@/components/ui/MetricCard";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import {
  BarChart3,
  Calendar,
  CircleDollarSign,
  Download,
  Info,
  Package,
  Receipt,
  TrendingUp,
  Users,
} from "lucide-react";
import type { AppliedRange, FinancialReport } from "@/types";

function rangeLabel(range?: AppliedRange) {
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

function ErrorState({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-medium text-rose-700 dark:text-rose-300"
    >
      {message}
    </p>
  );
}

function SectionShell({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof BarChart3;
  children: React.ReactNode;
  tone?: "primary" | "accent";
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <h2 className="text-xs sm:text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
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
    dotClass = "bg-amber-500";
  } else if (realProfit > 0) {
    message = `En este período vendiste ${formatReportMoney(totalSold)}. Te quedaron ${formatReportMoney(realProfit)} de ganancia después de ${formatReportMoney(expenses)} en gastos.`;
    dotClass = "bg-emerald-500";
  } else if (realProfit === 0) {
    message = `En este período vendiste ${formatReportMoney(totalSold)}. Quedaste en punto de equilibrio después de ${formatReportMoney(expenses)} en gastos.`;
  } else {
    message = `En este período vendiste ${formatReportMoney(totalSold)}. Estás con un balance negativo de ${formatReportMoney(Math.abs(realProfit))} después de ${formatReportMoney(expenses)} en gastos.`;
    dotClass = "bg-rose-500";
  }

  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-2.5">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
      <p className="text-xs font-medium text-foreground leading-relaxed tabular-nums">
        {message}
      </p>
    </div>
  );
}

function BreakdownCard({ report }: { report: FinancialReport }) {
  const totalSold = safeDecimalNumber(report.netIncome);
  const productCost = safeDecimalNumber(report.cogs);
  const grossProfit = safeDecimalNumber(report.grossProfit);
  const expenses = safeDecimalNumber(report.operatingExpenses);
  const realProfit = safeDecimalNumber(report.netProfit);

  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-border/60 bg-muted/20 p-4">
      <div>
        <p className="text-xs sm:text-sm font-semibold text-foreground">Desglose</p>
        <p className="mt-0.5 text-xs text-muted-foreground">El camino de tu plata</p>
      </div>

      <div className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Total vendido</span>
          <span className="font-mono font-semibold text-foreground tabular-nums">
            {formatReportMoney(totalSold)}
          </span>
        </div>

        <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
          <span>(-) Costo de productos</span>
          <span className="font-mono font-semibold tabular-nums">
            -{formatReportMoney(productCost)}
          </span>
        </div>

        <div className="border-t border-border/60" />

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Ganancia antes de gastos</span>
          <span className="font-mono font-semibold text-foreground tabular-nums">
            {formatReportMoney(grossProfit)}
          </span>
        </div>

        <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
          <span>(-) Gastos</span>
          <span className="font-mono font-semibold tabular-nums">
            -{formatReportMoney(expenses)}
          </span>
        </div>

        <div className="border-t border-border/60" />

        <div className="flex items-center justify-between pt-0.5">
          <span className="font-semibold text-foreground">Ganancia real</span>
          <span
            className={cn(
              "font-mono text-sm font-semibold tabular-nums",
              realProfit >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            {formatReportMoney(realProfit)}
          </span>
        </div>
      </div>
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
      sublabel: rangeLabel(range),
      value: safeDecimalNumber(current.netIncome),
      color: "bg-foreground/85",
    },
    {
      label: "Anterior",
      sublabel: comparisonRange ? rangeLabel(comparisonRange) : "Período previo",
      value: safeDecimalNumber(previous.netIncome),
      color: "bg-muted-foreground/45",
    },
  ];
  const scale = Math.max(
    ...metrics.map((m) => Math.abs(m.value)),
    1,
  );
  const currentProfit = safeDecimalNumber(current.netProfit);
  const previousProfit = safeDecimalNumber(previous.netProfit);
  const currentExpenses = safeDecimalNumber(current.operatingExpenses);
  const previousExpenses = safeDecimalNumber(previous.operatingExpenses);

  return (
    <div
      className="flex h-full flex-col justify-between space-y-4"
      aria-label={`Comparación económica por ${granularity === "day" ? "día" : "mes"}`}
      role="img"
    >
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs sm:text-sm font-semibold text-foreground">
              Comparación con período anterior
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Comparando el total vendido entre ambos períodos
            </p>
          </div>
          <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
            Granularidad: {granularity === "day" ? "día" : "mes"}
          </span>
        </div>
        <div className="space-y-2.5">
          {metrics.map((item) => (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {item.label}{" "}
                  <span className="font-mono text-[11px] font-normal text-muted-foreground tabular-nums">
                    ({item.sublabel})
                  </span>
                </span>
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {formatReportMoney(item.value)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-[3px] bg-muted/60">
                <div
                  className={cn("h-full rounded-[3px]", item.color)}
                  style={{
                    width: `${Math.max(2, (Math.abs(item.value) / scale) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 border-t border-border/60 pt-3 text-xs">
        <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-2">
          <span className="text-[11px] text-muted-foreground block">
            Ganancia anterior
          </span>
          <span className="mt-0.5 font-mono text-xs font-semibold text-foreground tabular-nums block">
            {formatReportMoney(previousProfit)}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            Actual: {formatReportMoney(currentProfit)}
          </span>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-2">
          <span className="text-[11px] text-muted-foreground block">
            Gastos anteriores
          </span>
          <span className="mt-0.5 font-mono text-xs font-semibold text-foreground tabular-nums block">
            {formatReportMoney(previousExpenses)}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            Actual: {formatReportMoney(currentExpenses)}
          </span>
        </div>
      </div>
    </div>
  );
}

function OperationalEmpty({ label }: { label: string }) {
  return (
    <EmptyState
      icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />}
      title={`Sin datos de ${label}`}
      subtitle="Prueba otro período o espera nuevas operaciones."
      className="min-h-[140px]"
    />
  );
}

export default function ReportsPage() {
  const toast = useToast();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showExporting, setShowExporting] = useState(false);
  const [showExportSection, setShowExportSection] = useState(false);

  const economic = useEconomicOverview(startDate, endDate);
  const cash = useCashFlow(startDate, endDate);
  const inventory = useInventorySnapshot(startDate, endDate);
  const paymentMethods = useSalesByPaymentMethod(startDate, endDate);
  const categories = useSalesByCategory(startDate, endDate);
  const topProducts = useTopSellingProducts(startDate, endDate, 5);
  const customers = useCustomerStatistics(startDate, endDate);
  const overview = economic.data;
  const current = overview?.current;

  const todayValue = getBogotaDateInputValue();
  const weekStartValue = shiftDateInputValue(todayValue, -6);
  const monthStartValue = shiftDateInputValue(todayValue, -29);
  const isAllDatesActive = !startDate && !endDate;
  const isTodayActive = startDate === todayValue && endDate === todayValue;
  const isWeekActive = startDate === weekStartValue && endDate === todayValue;
  const isLast30Active = startDate === monthStartValue && endDate === todayValue;

  const setAllDates = () => {
    setStartDate("");
    setEndDate("");
  };
  const setToday = () => {
    const today = getBogotaDateInputValue();
    setStartDate(today);
    setEndDate(today);
  };
  const setLast7Days = () => {
    const today = getBogotaDateInputValue();
    setStartDate(shiftDateInputValue(today, -6));
    setEndDate(today);
  };
  const setLast30Days = () => {
    const today = getBogotaDateInputValue();
    setStartDate(shiftDateInputValue(today, -29));
    setEndDate(today);
  };
  const handleEconomicExport = async () => {
    setShowExporting(true);
    try {
      await api.exportData("/exports/economic", {
        format: "excel",
        type: "economic",
        startDate,
        endDate,
      });
      toast.success("Exportación económica generada correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo generar la exportación"));
    } finally {
      setShowExporting(false);
    }
  };

  const operationalPaymentMethods = useMemo(
    () => paymentMethods.data?.data ?? [],
    [paymentMethods.data?.data],
  );
  const operationalCategories = useMemo(
    () => categories.data?.data ?? [],
    [categories.data?.data],
  );
  const operationalProducts = useMemo(
    () => topProducts.data?.data ?? [],
    [topProducts.data?.data],
  );
  const operationalCustomers = customers.data?.topCustomers ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-4 lg:space-y-5">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                Reportes
              </h1>
              <span className="hidden sm:inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                {rangeLabel(economic.data?.appliedRange)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Así va tu negocio
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowExportSection((current) => !current)}
            className="shrink-0"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {showExportSection ? "Ocultar exportación" : "Exportar"}
          </Button>
        </header>

        {showExportSection && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs">
            <div className="flex-1 text-xs text-muted-foreground">
              Genera el paquete económico del período{" "}
              <span className="font-mono font-semibold text-foreground tabular-nums">
                ({startDate} → {endDate})
              </span>
              .
            </div>
            <Button size="sm" onClick={handleEconomicExport} loading={showExporting}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Exportar economía
            </Button>
          </div>
        )}

        <section
          className="rounded-xl border border-border/70 bg-card p-2.5 shadow-2xs"
          aria-label="Filtros de período"
        >
          <div className="flex flex-wrap items-center gap-2">
            <FilterGroup label="Período">
              <FilterOptionButton active={isAllDatesActive} onClick={setAllDates}>
                Todo
              </FilterOptionButton>
              <FilterOptionButton active={isTodayActive} onClick={setToday}>
                Hoy
              </FilterOptionButton>
              <FilterOptionButton active={isWeekActive} onClick={setLast7Days}>
                7D
              </FilterOptionButton>
              <FilterOptionButton active={isLast30Active} onClick={setLast30Days}>
                Últimos 30 días
              </FilterOptionButton>
            </FilterGroup>

            <div className="flex flex-wrap items-center gap-2">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="reports-start"
              >
                Desde
              </label>
              <input
                id="reports-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="h-8 rounded-lg border border-border/70 bg-muted/30 px-2.5 font-mono text-xs text-foreground tabular-nums focus:border-border focus:bg-background focus:outline-none transition-colors"
              />
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="reports-end"
              >
                Hasta
              </label>
              <input
                id="reports-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="h-8 rounded-lg border border-border/70 bg-muted/30 px-2.5 font-mono text-xs text-foreground tabular-nums focus:border-border focus:bg-background focus:outline-none transition-colors"
              />
            </div>

            {(startDate || endDate) && (
              <FilterClearButton
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
              />
            )}

            <span className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
              <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
              {rangeLabel(economic.data?.appliedRange)}
            </span>
          </div>
        </section>

        <SectionShell title="Economía" icon={CircleDollarSign}>
          {economic.isLoading ? (
            <div aria-busy="true">
              <LoadingState
                icon={<CircleDollarSign className="h-4 w-4 text-muted-foreground" />}
                message="Cargando economía..."
              />
            </div>
          ) : economic.error ? (
            <ErrorState
              message={getApiErrorMessage(
                economic.error,
                "No se pudo cargar el resumen económico",
              )}
            />
          ) : !current ? (
            <OperationalEmpty label="economía" />
          ) : (
            <>
              <NarrativeSummary report={current} />
              <div className="grid gap-3.5 lg:gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Total vendido"
                  value={formatReportMoney(current.netIncome)}
                  helper="Lo que entró por ventas"
                  delta={overview!.deltas.netIncome}
                />
                <MetricCard
                  label="Ganancia antes de gastos"
                  value={formatReportMoney(current.grossProfit)}
                  helper={`${current.grossMarginPercentage?.toFixed(1) ?? "-"}% de margen sobre ventas`}
                  delta={overview!.deltas.grossProfit}
                />
                <MetricCard
                  label="Ganancia real"
                  value={formatReportMoney(current.netProfit)}
                  helper={`${current.netMarginPercentage?.toFixed(1) ?? "-"}% de margen neto`}
                  delta={overview!.deltas.netProfit}
                />
                <MetricCard
                  label="Gastos"
                  value={formatReportMoney(current.operatingExpenses)}
                  helper="Lo que pagás para que funcione el negocio"
                  delta={overview!.deltas.operatingExpenses}
                />
              </div>
              {current.dataQuality.excludedItems > 0 && (
                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
                  <Info
                    className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <p role="status" className="text-xs text-amber-700 dark:text-amber-300 tabular-nums">
                    <span className="font-semibold">
                      {current.dataQuality.snapshotBackedItems} registros con costo exacto
                    </span>
                    .{" "}
                    <span>
                      {current.dataQuality.excludedItems} registro
                      {current.dataQuality.excludedItems === 1 ? "" : "s"} excluido
                      {current.dataQuality.excludedItems === 1 ? "" : "s"}; no se estimó
                      su costo actual (la ganancia es aproximada).
                    </span>
                  </p>
                </div>
              )}
              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <ComparisonChart
                    current={current}
                    previous={overview!.previous}
                    range={overview!.appliedRange}
                    comparisonRange={overview!.comparisonRange}
                  />
                </div>
                <BreakdownCard report={current} />
              </div>
            </>
          )}
        </SectionShell>

        <div className="grid gap-4 lg:gap-5 xl:grid-cols-2">
          <SectionShell title="Caja y pagos" icon={Receipt}>
            {cash.isLoading ? (
              <div aria-busy="true">
                <LoadingState
                  icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
                  message="Cargando caja..."
                />
              </div>
            ) : cash.error ? (
              <ErrorState
                message={getApiErrorMessage(cash.error, "No se pudo cargar caja")}
              />
            ) : cash.data ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-muted/25 p-3.5">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <p className="text-xs font-medium text-muted-foreground">
                        Plata que entró
                      </p>
                    </div>
                    <p className="mt-1.5 font-mono text-lg sm:text-xl font-semibold tracking-tight text-foreground tabular-nums">
                      {formatReportMoney(cash.data.collections.total)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/25 p-3.5">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                      <p className="text-xs font-medium text-muted-foreground">
                        Plata que salió
                      </p>
                    </div>
                    <p className="mt-1.5 font-mono text-lg sm:text-xl font-semibold tracking-tight text-foreground tabular-nums">
                      {formatReportMoney(cash.data.expensePayments.total)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/15 px-3.5 py-2.5 text-xs">
                  <span className="font-medium text-muted-foreground">
                    Flujo neto de caja
                  </span>
                  <span
                    className={cn(
                      "font-mono font-semibold tabular-nums",
                      safeDecimalNumber(cash.data.collections.total) -
                        safeDecimalNumber(cash.data.expensePayments.total) >=
                        0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400",
                    )}
                  >
                    {formatReportMoney(
                      safeDecimalNumber(cash.data.collections.total) -
                        safeDecimalNumber(cash.data.expensePayments.total),
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <OperationalEmpty label="caja" />
            )}
          </SectionShell>

          <SectionShell title="Inventario actual" icon={Package}>
            {inventory.isLoading ? (
              <div aria-busy="true">
                <LoadingState
                  icon={<Package className="h-4 w-4 text-muted-foreground" />}
                  message="Cargando inventario..."
                />
              </div>
            ) : inventory.error ? (
              <ErrorState
                message={getApiErrorMessage(
                  inventory.error,
                  "No se pudo cargar inventario",
                )}
              />
            ) : inventory.data ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Lo que costó tu inventario
                  </p>
                  <p className="mt-1 font-mono text-sm sm:text-base font-semibold text-foreground tabular-nums">
                    {formatReportMoney(inventory.data.current.stockValue)}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Lo que vale si vendés todo
                  </p>
                  <p className="mt-1 font-mono text-sm sm:text-base font-semibold text-foreground tabular-nums">
                    {formatReportMoney(inventory.data.current.retailValue)}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Ganancia posible
                  </p>
                  <p className="mt-1 font-mono text-sm sm:text-base font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {formatReportMoney(inventory.data.current.potentialProfit)}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Unidades en stock
                  </p>
                  <p className="mt-1 font-mono text-sm sm:text-base font-semibold text-foreground tabular-nums">
                    {inventory.data.current.stockQuantity.toLocaleString("es-CO")}
                  </p>
                </div>
              </div>
            ) : (
              <OperationalEmpty label="inventario" />
            )}
          </SectionShell>
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground">
            Análisis operativo
          </h2>
          <div className="grid gap-4 lg:gap-5 xl:grid-cols-2">
            <SectionShell title="Productos Más Vendidos" icon={TrendingUp}>
              {topProducts.isLoading ? (
                <div aria-busy="true">
                  <LoadingState
                    icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
                    message="Cargando productos..."
                  />
                </div>
              ) : topProducts.error ? (
                <ErrorState
                  message={getApiErrorMessage(
                    topProducts.error,
                    "No se pudieron cargar productos",
                  )}
                />
              ) : operationalProducts.length === 0 ? (
                <OperationalEmpty label="productos" />
              ) : (
                <div className="space-y-2">
                  {(() => {
                    const maxProductTotal = Math.max(
                      ...operationalProducts.map((p) => p.total || 0),
                      1,
                    );
                    return operationalProducts.map((product, index) => (
                      <div
                        key={product.productId}
                        className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 transition-colors hover:border-border"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50 font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
                              {index + 1}
                            </span>
                            <span className="truncate text-xs sm:text-sm font-medium text-foreground">
                              {product.productName}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2.5">
                            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                              {product.quantity} vendidos
                            </span>
                            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                              {formatCurrency(product.total)}
                            </span>
                          </div>
                        </div>
                        <div className="h-1 overflow-hidden rounded-[2px] bg-muted/60">
                          <div
                            className="h-full rounded-[2px] bg-foreground/70"
                            style={{
                              width: `${Math.max(3, ((product.total || 0) / maxProductTotal) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </SectionShell>

            <SectionShell title="Categorías" icon={BarChart3}>
              {categories.isLoading ? (
                <div aria-busy="true">
                  <LoadingState
                    icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
                    message="Cargando categorías..."
                  />
                </div>
              ) : categories.error ? (
                <ErrorState
                  message={getApiErrorMessage(
                    categories.error,
                    "No se pudieron cargar categorías",
                  )}
                />
              ) : operationalCategories.length === 0 ? (
                <OperationalEmpty label="categorías" />
              ) : (
                <div className="space-y-2">
                  {(() => {
                    const totalCategorySales = Math.max(
                      operationalCategories.reduce((sum, c) => sum + (c.total || 0), 0),
                      1,
                    );
                    return operationalCategories.map((category) => {
                      const share = Math.round(((category.total || 0) / totalCategorySales) * 100);
                      return (
                        <div
                          key={category.category}
                          className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 transition-colors hover:border-border"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                              <span className="truncate text-xs sm:text-sm font-medium text-foreground">
                                {category.category}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                                {category.quantity}{" "}
                                <span className="font-sans font-normal text-muted-foreground">
                                  unidades
                                </span>
                              </span>
                              <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                                {formatCurrency(category.total)}
                              </span>
                            </div>
                          </div>
                          <div className="h-1 overflow-hidden rounded-[2px] bg-muted/60">
                            <div
                              className="h-full rounded-[2px] bg-foreground/65"
                              style={{ width: `${Math.max(3, share)}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </SectionShell>

            <SectionShell title="Top Clientes" icon={Users}>
              {customers.isLoading ? (
                <div aria-busy="true">
                  <LoadingState
                    icon={<Users className="h-4 w-4 text-muted-foreground" />}
                    message="Cargando clientes..."
                  />
                </div>
              ) : customers.error ? (
                <ErrorState
                  message={getApiErrorMessage(
                    customers.error,
                    "No se pudieron cargar clientes",
                  )}
                />
              ) : operationalCustomers.length === 0 ? (
                <OperationalEmpty label="clientes" />
              ) : (
                <div className="overflow-hidden rounded-lg border border-border/60">
                  <div className="overflow-x-auto">
                    <Table variant="default" className="min-w-[420px]">
                      <TableHeader>
                        <TableRow>
                          <TableCell as="th">Cliente</TableCell>
                          <TableCell as="th" className="text-right">
                            Compras
                          </TableCell>
                          <TableCell as="th" className="text-right">
                            Total
                          </TableCell>
                        </TableRow>
                      </TableHeader>
                      <tbody>
                        {operationalCustomers.map((customer) => (
                          <TableRow key={customer.customerId}>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50 font-mono text-[11px] font-semibold text-foreground">
                                  {customer.customerName.charAt(0).toUpperCase()}
                                </span>
                                <span className="text-xs font-medium text-foreground truncate">
                                  {customer.customerName}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                              {customer.totalSales}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-semibold text-foreground tabular-nums">
                              {formatCurrency(customer.totalRevenue)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </div>
              )}
            </SectionShell>

            <SectionShell title="Métodos de Pago" icon={Receipt}>
              {paymentMethods.isLoading ? (
                <div aria-busy="true">
                  <LoadingState
                    icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
                    message="Cargando pagos..."
                  />
                </div>
              ) : paymentMethods.error ? (
                <ErrorState
                  message={getApiErrorMessage(
                    paymentMethods.error,
                    "No se pudieron cargar pagos",
                  )}
                />
              ) : operationalPaymentMethods.length === 0 ? (
                <OperationalEmpty label="métodos de pago" />
              ) : (
                <div className="space-y-2">
                  {(() => {
                    const totalMethodsAmount = Math.max(
                      operationalPaymentMethods.reduce((sum, m) => sum + (m.total || 0), 0),
                      1,
                    );
                    return operationalPaymentMethods.map((method) => {
                      const share = Math.round(((method.total || 0) / totalMethodsAmount) * 100);
                      return (
                        <div
                          key={method.paymentMethod}
                          className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 transition-colors hover:border-border"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                              <span className="text-xs sm:text-sm font-medium text-foreground">
                                {formatPaymentMethod(method.paymentMethod)}
                              </span>
                              <span className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                                {share}%
                              </span>
                            </div>
                            <div className="flex items-center gap-2.5">
                              {method.count != null && (
                                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                                  {method.count} {method.count === 1 ? "pago" : "pagos"}
                                </span>
                              )}
                              <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                                {formatCurrency(method.total)}
                              </span>
                            </div>
                          </div>
                          <div className="h-1 overflow-hidden rounded-[2px] bg-muted/60">
                            <div
                              className="h-full rounded-[2px] bg-foreground/65"
                              style={{ width: `${Math.max(3, share)}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </SectionShell>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
