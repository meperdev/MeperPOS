import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const useEconomicOverviewMock = vi.fn();
const useCashFlowMock = vi.fn();
const useInventorySnapshotMock = vi.fn();
const useSalesByPaymentMethodMock = vi.fn();
const useSalesByCategoryMock = vi.fn();
const useTopSellingProductsMock = vi.fn();
const useCustomerStatisticsMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    exportData: vi.fn(),
  },
  getApiErrorMessage: () => "error",
}));

vi.mock("@/hooks/useReports", () => ({
  useEconomicOverview: (startDate?: string, endDate?: string) =>
    useEconomicOverviewMock(startDate, endDate),
  useCashFlow: (startDate?: string, endDate?: string) =>
    useCashFlowMock(startDate, endDate),
  useInventorySnapshot: (startDate?: string, endDate?: string) =>
    useInventorySnapshotMock(startDate, endDate),
  useSalesByPaymentMethod: (startDate?: string, endDate?: string) =>
    useSalesByPaymentMethodMock(startDate, endDate),
  useSalesByCategory: (startDate?: string, endDate?: string) =>
    useSalesByCategoryMock(startDate, endDate),
  useTopSellingProducts: (startDate?: string, endDate?: string, limit?: number) =>
    useTopSellingProductsMock(startDate, endDate, limit),
  useCustomerStatistics: (startDate?: string, endDate?: string) =>
    useCustomerStatisticsMock(startDate, endDate),
}));

import ReportsPage from "./page";
import { api } from "@/lib/api";

const range = {
  startDate: "2026-01-10",
  endDate: "2026-01-12",
  timezone: "America/Bogota",
};

describe("Reports economics-first evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useEconomicOverviewMock.mockReturnValue({
      data: {
        current: {
          netIncome: "100000.25",
          tax: "19000.05",
          cogs: "40000.00",
          grossProfit: "60000.25",
          grossMarginPercentage: 60.0001,
          operatingExpenses: "10000.00",
          netProfit: "50000.25",
          netMarginPercentage: 50.0001,
          products: [],
          dataQuality: { snapshotBackedItems: 3, excludedItems: 1, excludedQuantity: 2 },
        },
        previous: {
          netIncome: "80000.00",
          tax: "15000.00",
          cogs: "30000.00",
          grossProfit: "50000.00",
          grossMarginPercentage: 62.5,
          operatingExpenses: "10000.00",
          netProfit: "40000.00",
          netMarginPercentage: 50,
          products: [],
          dataQuality: { snapshotBackedItems: 2, excludedItems: 0, excludedQuantity: 0 },
        },
        deltas: { netIncome: { absolute: "20000.25", percentage: 25.31 } },
        appliedRange: range,
        comparisonRange: { ...range, startDate: "2026-01-07", endDate: "2026-01-09" },
      },
      isLoading: false,
      error: null,
    });

    useCashFlowMock.mockReturnValue({ data: { collections: { total: "70000.00", byPaymentMethod: [] }, expensePayments: { total: "5000.00", byPaymentMethod: [] }, appliedRange: range }, isLoading: false, error: null });
    useInventorySnapshotMock.mockReturnValue({ data: { isCurrentSnapshot: true, valuationBasis: "CURRENT_STOCK_AT_CURRENT_COST", current: { stockQuantity: 10, stockValue: "50000.00", retailValue: "90000.00", potentialProfit: "40000.00" }, movements: { totalQuantity: 4, byType: {} }, appliedRange: range }, isLoading: false, error: null });
    useSalesByPaymentMethodMock.mockReturnValue({
      data: {
        data: [{ paymentMethod: "CASH", total: 100000, subtotal: 90000, count: 3 }],
        appliedRange: range,
      },
      isLoading: false,
    });

    useSalesByCategoryMock.mockReturnValue({
      data: {
        data: [{ category: "Repuestos", total: 100000, quantity: 4 }],
        appliedRange: range,
      },
      isLoading: false,
    });

    useTopSellingProductsMock.mockReturnValue({
      data: {
        data: [{ productId: "p-1", productName: "Casco", quantity: 4, total: 100000, stock: 8 }],
        appliedRange: range,
      },
      isLoading: false,
    });

    useCustomerStatisticsMock.mockReturnValue({
      data: {
        totalCustomers: 6,
        activeCustomers: 3,
        topCustomers: [
          {
            customerId: "c-1",
            customerName: "Cliente Uno",
            totalSales: 2,
            totalRevenue: 50000,
          },
        ],
        appliedRange: range,
      },
      isLoading: false,
    });

  });

  afterEach(() => {
    cleanup();
  });

  it("puts economics first and renders Decimal strings as presentation values", () => {
    render(<ReportsPage />);

    expect(screen.getByRole("heading", { name: "Economía" })).toBeTruthy();
    expect(screen.getAllByText(/100\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Comparación con período anterior/)).toBeTruthy();
    expect(screen.getByText("Productos más vendidos")).toBeTruthy();
    expect(screen.getByText("Mejores clientes")).toBeTruthy();
    expect(screen.getByText("Métodos de pago")).toBeTruthy();
    expect(screen.queryByText("Rendimiento por vendedor")).toBeNull();
    expect(screen.queryByText("Importar Inventario")).toBeNull();
  });

  it("expands the enterprise export toggle and triggers the economic export", () => {
    render(<ReportsPage />);

    const toggle = screen.getByRole("button", { name: "Exportar" });
    expect(screen.queryByText(/Genera el paquete económico del período/)).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Exportar economía" })).toBeTruthy();
    expect(screen.getByText(/Genera el paquete económico del período/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Exportar economía" }));
    expect(api.exportData).toHaveBeenCalledWith(
      "/exports/economic",
      expect.objectContaining({ format: "excel", type: "economic" }),
    );
  });

  it("exposes the financial data-quality warning instead of estimating costs", () => {
    render(<ReportsPage />);

    expect(screen.getByRole("status")).toHaveTextContent(/1 registro/);
    expect(screen.getByText(/registros con costo exacto/)).toBeTruthy();
  });

  it("announces the economic loading state", () => {
    useEconomicOverviewMock.mockReturnValueOnce({ data: undefined, isLoading: true, error: null });
    render(<ReportsPage />);
    expect(screen.getByText("Cargando economía…")).toBeTruthy();
    expect(document.querySelector("[aria-busy='true']")).toBeTruthy();
  });

  it("announces an economic request error", () => {
    useEconomicOverviewMock.mockReturnValueOnce({ data: undefined, isLoading: false, error: new Error("network") });
    render(<ReportsPage />);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("renders humanized business labels, narrative summary, and breakdown card", () => {
    render(<ReportsPage />);

    // Header subtitle
    expect(screen.getByText("Así va tu negocio")).toBeTruthy();

    // Narrative summary
    expect(
      screen.getByText(/En este período vendiste.*Te quedaron.*de ganancia después de.*en gastos/)
    ).toBeTruthy();

    // Humanized KPI cards & Breakdown labels
    expect(screen.getAllByText("Total vendido").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Ganancia antes de gastos").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Ganancia real").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Gastos/).length).toBeGreaterThanOrEqual(2);

    // Helpers
    expect(screen.getByText("Lo que entró por ventas")).toBeTruthy();
    expect(screen.getByText("Lo que pagas para que funcione el negocio")).toBeTruthy();

    // Breakdown card
    expect(screen.getByText("Desglose")).toBeTruthy();
    expect(screen.getByText("El camino de tu plata")).toBeTruthy();
    expect(screen.getByText("(-) Costo de productos")).toBeTruthy();
    expect(screen.getByText("(-) Gastos")).toBeTruthy();

    // Humanized Cash and Inventory labels
    expect(screen.getByText("Plata que entró")).toBeTruthy();
    expect(screen.getByText("Plata que salió")).toBeTruthy();
    expect(screen.getByText("Lo que costó tu inventario")).toBeTruthy();
    expect(screen.getByText("Lo que vale si vendes todo")).toBeTruthy();
    expect(screen.getByText("Ganancia posible")).toBeTruthy();
  });

  it("renders an intentional empty state when economics has no data", () => {
    useEconomicOverviewMock.mockReturnValueOnce({ data: undefined, isLoading: false, error: null });
    render(<ReportsPage />);
    expect(screen.getByText("Sin datos de economía")).toBeTruthy();
  });
});
