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

export function useDashboard(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["dashboard", startDate, endDate],
    queryFn: () =>
      api
        .get<DashboardResponse>(
          "/reports/dashboard",
          buildDateRangeParams(startDate, endDate),
        )
        .then((res) => res.data),
  });
}

export function useEconomicOverview(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["reports", "economic", startDate, endDate],
    queryFn: () =>
      api
        .get<FinancialOverview>("/reports/economic", buildDateRangeParams(startDate, endDate))
        .then((res) => res.data),
  });
}

export function useCashFlow(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["reports", "economic", "cash", startDate, endDate],
    queryFn: () =>
      api
        .get<CashFlowReport>("/reports/economic/cash", buildDateRangeParams(startDate, endDate))
        .then((res) => res.data),
  });
}

export function useInventorySnapshot(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["reports", "economic", "inventory", startDate, endDate],
    queryFn: () =>
      api
        .get<InventorySnapshotReport>("/reports/economic/inventory", buildDateRangeParams(startDate, endDate))
        .then((res) => res.data),
  });
}

export function useSalesByPaymentMethod(
  startDate?: string,
  endDate?: string
) {
  return useQuery({
    queryKey: ["reports", "sales", "payment-method", startDate, endDate],
    queryFn: () =>
      api
        .get<ReportEnvelope<SaleByPaymentMethod[]>>(
          "/reports/sales/payment-method",
          buildDateRangeParams(startDate, endDate),
        )
        .then((res) => res.data),
  });
}

export function useSalesByCategory(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["reports", "sales", "category", startDate, endDate],
    queryFn: () =>
      api
        .get<ReportEnvelope<SaleByCategory[]>>(
          "/reports/sales/category",
          buildDateRangeParams(startDate, endDate),
        )
        .then((res) => res.data),
  });
}

export function useSalesByCategoryDaily(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ["reports", "sales", "category-daily", startDate, endDate],
    queryFn: () =>
      api
        .get<ReportEnvelope<SaleByCategoryDaily[]>>(
          "/reports/sales/category-daily",
          buildDateRangeParams(startDate, endDate),
        )
        .then((res) => res.data),
  });
}

export function useTopSellingProducts(
  startDate?: string,
  endDate?: string,
  limit = 10
) {
  return useQuery({
    queryKey: ["reports", "products", "top-selling", startDate, endDate, limit],
    queryFn: () =>
      api
        .get<ReportEnvelope<TopSellingProduct[]>>(
          "/reports/products/top-selling",
          {
            ...buildDateRangeParams(startDate, endDate),
            limit,
          },
        )
        .then((res) => res.data),
  });
}

export function useCustomerStatistics(
  startDate?: string,
  endDate?: string,
) {
  return useQuery({
    queryKey: ["reports", "customers", "statistics", startDate, endDate],
    queryFn: () =>
      api
        .get<CustomerStatistics>(
          "/reports/customers/statistics",
          buildDateRangeParams(startDate, endDate),
        )
        .then((res) => res.data),
  });
}

/**
 * Sales per seller for the page's period. `compare=false` keeps the rows on the
 * same window the rest of the analysis uses instead of the backend's shifted
 * comparison period.
 */
export function useUserPerformance(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["reports", "users", "performance", startDate, endDate],
    queryFn: () =>
      api
        .get<UserPerformanceReport>("/reports/users/performance", {
          startDate,
          endDate,
          compare: "false",
        })
        .then((res) => res.data),
    enabled: !!startDate && !!endDate,
  });
}

export function useDailySales(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["reports", "sales", "daily", startDate, endDate],
    queryFn: () =>
      api
        .get<ReportEnvelope<DailySale[]>>("/reports/sales/daily", {
          startDate,
          endDate,
        })
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
