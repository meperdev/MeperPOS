"use client";

import { useState } from "react";
import { Download, FileDown } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { CashFlowBlock } from "@/components/reports/CashFlowBlock";
import { CategoriesBlock } from "@/components/reports/CategoriesBlock";
import { CustomersBlock } from "@/components/reports/CustomersBlock";
import { DailyReportSection } from "@/components/reports/DailyReportSection";
import { EconomySection } from "@/components/reports/EconomySection";
import { InventoryBlock } from "@/components/reports/InventoryBlock";
import { PaymentMethodsBlock } from "@/components/reports/PaymentMethodsBlock";
import { PeriodFilter } from "@/components/reports/PeriodFilter";
import { ProductProfitBlock } from "@/components/reports/ProductProfitBlock";
import { SellerPerformanceBlock } from "@/components/reports/SellerPerformanceBlock";
import { TopProductsBlock } from "@/components/reports/TopProductsBlock";
import { useDailyReport } from "@/hooks/useDailyReport";
import {
  useCashFlow,
  useCustomerStatistics,
  useEconomicOverview,
  useInventorySnapshot,
  useSalesByCategory,
  useSalesByPaymentMethod,
  useTopSellingProducts,
  useUserPerformance,
} from "@/hooks/useReports";
import { useToast } from "@/contexts/ToastContext";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, getApiErrorMessage } from "@/lib/api";
import { reportPeriodPresets } from "@/lib/reportPresentation";
import { getBogotaDateInputValue } from "@/lib/utils";
import type { AppliedRange } from "@/types";

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

export default function ReportsPage() {
  const toast = useToast();
  const presets = reportPeriodPresets(getBogotaDateInputValue());
  const [range, setRange] = useState(() => {
    const thisMonth = presets.find((preset) => preset.id === "thisMonth")!;
    return { startDate: thisMonth.startDate, endDate: thisMonth.endDate };
  });
  const [showExporting, setShowExporting] = useState(false);
  const [isDownloadingDailyReport, setIsDownloadingDailyReport] = useState(false);
  const { startDate, endDate } = range;

  const dailyReport = useDailyReport();
  const economic = useEconomicOverview(startDate, endDate);
  const cash = useCashFlow(startDate, endDate);
  const inventory = useInventorySnapshot(startDate, endDate);
  const paymentMethods = useSalesByPaymentMethod(startDate, endDate);
  const categories = useSalesByCategory(startDate, endDate);
  const topProducts = useTopSellingProducts(startDate, endDate, 5);
  const customers = useCustomerStatistics(startDate, endDate);
  const sellers = useUserPerformance(startDate, endDate);
  const current = economic.data?.current;
  const appliedLabel = rangeLabel(economic.data?.appliedRange);

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

  const handleDailyReportPdf = async () => {
    setIsDownloadingDailyReport(true);
    try {
      await api.downloadData("/reports/daily-report/pdf");
      toast.success("Reporte del día descargado");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo generar el reporte del día"));
    } finally {
      setIsDownloadingDailyReport(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 lg:space-y-5">
        <PageHeader
          title="Reportes"
          count={appliedLabel}
          subtitle="Así va tu negocio"
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDailyReportPdf}
                loading={isDownloadingDailyReport}
                className="shrink-0"
              >
                {!isDownloadingDailyReport && (
                  <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Reporte del día (PDF)
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleEconomicExport}
                loading={showExporting}
                className="shrink-0"
              >
                {!showExporting && <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                Exportar
              </Button>
            </>
          }
        />

        <DailyReportSection
          report={dailyReport.data}
          isLoading={dailyReport.isLoading}
          error={dailyReport.error}
          onRetry={() => dailyReport.refetch()}
          onRefresh={() => dailyReport.refetch()}
          isRefreshing={dailyReport.isFetching}
        />

        <PeriodFilter
          presets={presets}
          startDate={startDate}
          endDate={endDate}
          appliedLabel={appliedLabel}
          onChange={setRange}
        />

        <div className="space-y-4 lg:space-y-5">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Análisis del período
          </h2>

          <EconomySection query={economic} />

          <div className="grid items-start gap-4 lg:gap-5 xl:grid-cols-2">
            <CashFlowBlock query={cash} />
            <InventoryBlock query={inventory} />
          </div>

          <div className="grid items-start gap-4 lg:gap-5 xl:grid-cols-2">
            <TopProductsBlock query={topProducts} />
            <ProductProfitBlock
              products={current?.products ?? []}
              isLoading={economic.isLoading}
            />
          </div>

          <div className="grid items-start gap-4 lg:gap-5 xl:grid-cols-2">
            <CategoriesBlock query={categories} />
            <PaymentMethodsBlock query={paymentMethods} />
          </div>

          <div className="grid items-start gap-4 lg:gap-5 xl:grid-cols-2">
            <CustomersBlock query={customers} />
            <SellerPerformanceBlock query={sellers} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
