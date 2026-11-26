"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AppliedRange,
  DashboardData,
  SaleByPaymentMethod,
  SaleByCategory,
  SaleByCategoryDaily,
  TopSellingProduct,
  CustomerStatistics,
  DailySale,
  ReportEnvelope,
  FinancialOverview,
  CashFlowReport,
  InventorySnapshotReport,
  UserPerformanceReport,
} from "@/types";

type DashboardResponse = DashboardData & {
  appliedRange: AppliedRange;
  comparisonRange?: AppliedRange;
};

function buildDateRangeParams(startDate?: string, endDate?: string) {
  const params: Record<string, string> = {};

  if (startDate) {
    params.startDate = startDate;
  }

  if (endDate) {
    params.endDate = endDate;
  }

  return params;
}

/**
 * The query string of every sales-based report: the shared period plus the
 * optional site. A site is sent only when one is chosen, so the
 * organization-wide request stays byte-identical to what it always was. The
 * value is an authorized site id — the API answers 404 for any other one.
 */
function buildReportParams(
  startDate?: string,
  endDate?: string,
  locationId?: string,
) {
  return {
    ...buildDateRangeParams(startDate, endDate),
    ...(locationId ? { locationId } : {}),
  };
}

export function useDashboard(
  startDate?: string,
  endDate?: string,
  locationId?: string,
) {
  return useQuery({
    queryKey: ["dashboard", startDate, endDate, locationId],
    queryFn: () =>
      api
        .get<DashboardResponse>(
          "/reports/dashboard",
          buildReportParams(startDate, endDate, locationId),
        )
        .then((res) => res.data),
  });
}

/**
 * Organization economics: always the whole organization, because operating
 * expenses and payroll carry no site.
 */
export function useEconomicOverview(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["reports", "economic", startDate, endDate],
    queryFn: () =>
      api
        .get<FinancialOverview>("/reports/economic", buildDateRangeParams(startDate, endDate))
        .then((res) => res.data),
  });
}

/** Organization cash: expense payments carry no site. */
export function useCashFlow(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["reports", "economic", "cash", startDate, endDate],
    queryFn: () =>
      api
        .get<CashFlowReport>("/reports/economic/cash", buildDateRangeParams(startDate, endDate))
        .then((res) => res.data),
  });
}

export function useInventorySnapshot(
  startDate?: string,
  endDate?: string,
  locationId?: string,
) {
  return useQuery({
    queryKey: ["reports", "economic", "inventory", startDate, endDate, locationId],
    queryFn: () =>
      api
        .get<InventorySnapshotReport>(
          "/reports/economic/inventory",
          buildReportParams(startDate, endDate, locationId),
        )
        .then((res) => res.data),
  });
}

export function useSalesByPaymentMethod(
  startDate?: string,
  endDate?: string,
  locationId?: string,
) {
  return useQuery({
    queryKey: ["reports", "sales", "payment-method", startDate, endDate, locationId],
    queryFn: () =>
      api
        .get<ReportEnvelope<SaleByPaymentMethod[]>>(
          "/reports/sales/payment-method",
          buildReportParams(startDate, endDate, locationId),
        )
        .then((res) => res.data),
  });
}

export function useSalesByCategory(
  startDate?: string,
  endDate?: string,
  locationId?: string,
) {
  return useQuery({
    queryKey: ["reports", "sales", "category", startDate, endDate, locationId],
    queryFn: () =>
      api
        .get<ReportEnvelope<SaleByCategory[]>>(
          "/reports/sales/category",
          buildReportParams(startDate, endDate, locationId),
        )
        .then((res) => res.data),
  });
}

export function useSalesByCategoryDaily(
  startDate?: string,
  endDate?: string,
  locationId?: string,
) {
  return useQuery({
    queryKey: ["reports", "sales", "category-daily", startDate, endDate, locationId],
    queryFn: () =>
      api
        .get<ReportEnvelope<SaleByCategoryDaily[]>>(
          "/reports/sales/category-daily",
          buildReportParams(startDate, endDate, locationId),
        )
        .then((res) => res.data),
  });
}

export function useTopSellingProducts(
  startDate?: string,
  endDate?: string,
  limit = 10,
  locationId?: string,
) {
  return useQuery({
    queryKey: [
      "reports",
      "products",
      "top-selling",
      startDate,
      endDate,
      limit,
      locationId,
    ],
    queryFn: () =>
      api
        .get<ReportEnvelope<TopSellingProduct[]>>(
          "/reports/products/top-selling",
          {
            ...buildReportParams(startDate, endDate, locationId),
            limit,
          },
        )
        .then((res) => res.data),
  });
}

export function useCustomerStatistics(
  startDate?: string,
  endDate?: string,
  locationId?: string,
) {
  return useQuery({
    queryKey: ["reports", "customers", "statistics", startDate, endDate, locationId],
    queryFn: () =>
      api
        .get<CustomerStatistics>(
          "/reports/customers/statistics",
          buildReportParams(startDate, endDate, locationId),
        )
        .then((res) => res.data),
  });
}

/**
 * Sales per seller for the page's period. `compare=false` keeps the rows on the
 * same window the rest of the analysis uses instead of the backend's shifted
 * comparison period.
 */
export function useUserPerformance(
  startDate: string,
  endDate: string,
  locationId?: string,
) {
  return useQuery({
    queryKey: ["reports", "users", "performance", startDate, endDate, locationId],
    queryFn: () =>
      api
        .get<UserPerformanceReport>("/reports/users/performance", {
          ...buildReportParams(startDate, endDate, locationId),
          compare: "false",
        })
        .then((res) => res.data),
    enabled: !!startDate && !!endDate,
  });
}

export function useDailySales(
  startDate: string,
  endDate: string,
  locationId?: string,
) {
  return useQuery({
    queryKey: ["reports", "sales", "daily", startDate, endDate, locationId],
    queryFn: () =>
      api
        .get<ReportEnvelope<DailySale[]>>(
          "/reports/sales/daily",
          buildReportParams(startDate, endDate, locationId),
        )
        .then((res) => res.data),
    enabled: !!startDate && !!endDate,
  });
}

export function useExportData(
  type: "sales" | "products" | "customers" | "inventory",
  format: "pdf" | "excel" | "csv",
  data?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }
) {
  return api.exportData(`/exports/${type}`, {
    format,
    type,
    ...data,
  });
}
