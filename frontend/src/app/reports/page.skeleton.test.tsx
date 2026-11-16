import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const useEconomicOverviewMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  api: { exportData: vi.fn() },
  getApiErrorMessage: () => "error",
}));

const loading = () => ({
  data: undefined,
  isLoading: true,
  error: null,
  refetch: vi.fn(),
});

vi.mock("@/hooks/useReports", () => {
  const pending = () => ({
    data: undefined,
    isLoading: true,
    error: null,
    refetch: () => undefined,
  });
  return {
    useEconomicOverview: () => useEconomicOverviewMock(),
    useCashFlow: () => pending(),
    useInventorySnapshot: () => pending(),
    useSalesByPaymentMethod: () => pending(),
    useSalesByCategory: () => pending(),
    useTopSellingProducts: () => pending(),
    useCustomerStatistics: () => pending(),
  };
});

import ReportsPage from "./page";

afterEach(() => {
  cleanup();
  useEconomicOverviewMock.mockReset();
});

describe("Reportes loading", () => {
  it("paints each section's shape instead of a spinner while it loads", () => {
    useEconomicOverviewMock.mockReturnValue(loading());

    render(<ReportsPage />);

    // Every section keeps its own accessible loading message.
    for (const label of [
      "Cargando economía…",
      "Cargando caja…",
      "Cargando inventario…",
      "Cargando productos…",
      "Cargando categorías…",
      "Cargando clientes…",
      "Cargando pagos…",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBe(7);
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(7);
  });
});
