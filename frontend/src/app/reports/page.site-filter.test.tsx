import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { LocationSite } from "@/types";

const useEconomicOverviewMock = vi.fn();
const useCashFlowMock = vi.fn();
const useInventorySnapshotMock = vi.fn();
const useSalesByPaymentMethodMock = vi.fn();
const useSalesByCategoryMock = vi.fn();
const useTopSellingProductsMock = vi.fn();
const useCustomerStatisticsMock = vi.fn();
const useUserPerformanceMock = vi.fn();
const useDailyReportMock = vi.fn();
const useLocationsMock = vi.fn();

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
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  api: { exportData: vi.fn(), downloadData: vi.fn() },
  getApiErrorMessage: () => "error",
}));

vi.mock("@/hooks/useDailyReport", () => ({
  useDailyReport: () => useDailyReportMock(),
}));

vi.mock("@/hooks/useLocations", () => ({
  useLocations: () => useLocationsMock(),
}));

vi.mock("@/hooks/useReports", () => ({
  useEconomicOverview: (startDate?: string, endDate?: string, locationId?: string) =>
    useEconomicOverviewMock(startDate, endDate, locationId),
  useCashFlow: (startDate?: string, endDate?: string, locationId?: string) =>
    useCashFlowMock(startDate, endDate, locationId),
  useInventorySnapshot: (startDate?: string, endDate?: string, locationId?: string) =>
    useInventorySnapshotMock(startDate, endDate, locationId),
  useSalesByPaymentMethod: (startDate?: string, endDate?: string, locationId?: string) =>
    useSalesByPaymentMethodMock(startDate, endDate, locationId),
  useSalesByCategory: (startDate?: string, endDate?: string, locationId?: string) =>
    useSalesByCategoryMock(startDate, endDate, locationId),
  useTopSellingProducts: (
    startDate?: string,
    endDate?: string,
    limit?: number,
    locationId?: string,
  ) => useTopSellingProductsMock(startDate, endDate, limit, locationId),
  useCustomerStatistics: (startDate?: string, endDate?: string, locationId?: string) =>
    useCustomerStatisticsMock(startDate, endDate, locationId),
  useUserPerformance: (startDate?: string, endDate?: string, locationId?: string) =>
    useUserPerformanceMock(startDate, endDate, locationId),
}));

import ReportsPage from "./page";

const sites: LocationSite[] = [
  { id: "site-a", name: "Chapinero", type: "STORE", isDefault: true },
  { id: "site-b", name: "Usaquén", type: "STORE", isDefault: false },
];

const emptyQuery = () => ({
  data: undefined,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
});

describe("Reports page site scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDailyReportMock.mockReturnValue(emptyQuery());
    useEconomicOverviewMock.mockReturnValue(emptyQuery());
    useCashFlowMock.mockReturnValue(emptyQuery());
    useInventorySnapshotMock.mockReturnValue(emptyQuery());
    useSalesByPaymentMethodMock.mockReturnValue(emptyQuery());
    useSalesByCategoryMock.mockReturnValue(emptyQuery());
    useTopSellingProductsMock.mockReturnValue(emptyQuery());
    useCustomerStatisticsMock.mockReturnValue(emptyQuery());
    useUserPerformanceMock.mockReturnValue(emptyQuery());
    useLocationsMock.mockReturnValue({ data: sites });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens on every site and never sends a site to the organization-wide blocks", () => {
    render(<ReportsPage />);

    expect(screen.getByRole("button", { name: "Todas las sedes" })).toBeInTheDocument();

    const [, , paymentSite] = useSalesByPaymentMethodMock.mock.calls.at(-1)!;
    expect(paymentSite).toBeUndefined();
    expect(useEconomicOverviewMock.mock.calls.at(-1)![2]).toBeUndefined();
    expect(useCashFlowMock.mock.calls.at(-1)![2]).toBeUndefined();
  });

  it("sends the chosen site to every sales-based query and to the stock block", () => {
    render(<ReportsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Todas las sedes" }));
    fireEvent.click(screen.getByRole("option", { name: "Usaquén" }));

    expect(useSalesByPaymentMethodMock.mock.calls.at(-1)![2]).toBe("site-b");
    expect(useSalesByCategoryMock.mock.calls.at(-1)![2]).toBe("site-b");
    expect(useTopSellingProductsMock.mock.calls.at(-1)![3]).toBe("site-b");
    expect(useCustomerStatisticsMock.mock.calls.at(-1)![2]).toBe("site-b");
    expect(useUserPerformanceMock.mock.calls.at(-1)![2]).toBe("site-b");
    expect(useInventorySnapshotMock.mock.calls.at(-1)![2]).toBe("site-b");
    // Expenses and cash carry no site: those two keep asking the organization.
    expect(useEconomicOverviewMock.mock.calls.at(-1)![2]).toBeUndefined();
    expect(useCashFlowMock.mock.calls.at(-1)![2]).toBeUndefined();
  });

  it("says out loud which figures stay organization-wide", () => {
    render(<ReportsPage />);

    expect(
      screen.queryByText("Valores de toda la organización"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Todas las sedes" }));
    fireEvent.click(screen.getByRole("option", { name: "Usaquén" }));

    expect(
      screen.getAllByText("Valores de toda la organización").length,
    ).toBeGreaterThan(0);
  });

  it("hides the selector for a single-site organization", () => {
    useLocationsMock.mockReturnValue({ data: [sites[0]] });

    render(<ReportsPage />);

    expect(
      screen.queryByRole("button", { name: "Todas las sedes" }),
    ).not.toBeInTheDocument();
  });
});
