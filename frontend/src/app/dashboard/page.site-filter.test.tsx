import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { LocationSite } from "@/types";

const useDashboardMock = vi.fn();
const useDailySalesMock = vi.fn();
const useSalesByCategoryDailyMock = vi.fn();
const useSalesByPaymentMethodMock = vi.fn();
const useTopSellingProductsMock = vi.fn();
const useExpensesMock = vi.fn();
const useTasksMock = vi.fn();
const useSalesMock = vi.fn();
const useLocationsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useReports", () => ({
  useDashboard: (startDate?: string, endDate?: string, locationId?: string) =>
    useDashboardMock(startDate, endDate, locationId),
  useDailySales: (startDate: string, endDate: string, locationId?: string) =>
    useDailySalesMock(startDate, endDate, locationId),
  useSalesByCategoryDaily: (
    startDate: string,
    endDate: string,
    locationId?: string,
  ) => useSalesByCategoryDailyMock(startDate, endDate, locationId),
  useSalesByPaymentMethod: (
    startDate: string,
    endDate: string,
    locationId?: string,
  ) => useSalesByPaymentMethodMock(startDate, endDate, locationId),
  useTopSellingProducts: (
    startDate: string,
    endDate: string,
    limit: number,
    locationId?: string,
  ) => useTopSellingProductsMock(startDate, endDate, limit, locationId),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Ana Admin", role: "ADMIN" } }),
}));

vi.mock("@/hooks/useExpenses", () => ({
  useExpenses: (params: unknown) => useExpensesMock(params),
}));

vi.mock("@/hooks/useTasks", () => ({
  useTasks: () => useTasksMock(),
}));

vi.mock("@/hooks/useSales", () => ({
  useSales: (params: unknown) => useSalesMock(params),
}));

vi.mock("@/hooks/useLocations", () => ({
  useLocations: () => useLocationsMock(),
}));

import DashboardPage from "./page";

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

describe("Dashboard site scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDashboardMock.mockReturnValue(emptyQuery());
    useDailySalesMock.mockReturnValue(emptyQuery());
    useSalesByCategoryDailyMock.mockReturnValue(emptyQuery());
    useSalesByPaymentMethodMock.mockReturnValue(emptyQuery());
    useTopSellingProductsMock.mockReturnValue(emptyQuery());
    useExpensesMock.mockReturnValue(emptyQuery());
    useTasksMock.mockReturnValue(emptyQuery());
    useSalesMock.mockReturnValue(emptyQuery());
    useLocationsMock.mockReturnValue({ data: sites });
  });

  afterEach(() => {
    cleanup();
  });

  it("starts on every site", () => {
    render(<DashboardPage />);

    expect(screen.getByRole("button", { name: "Todas las sedes" })).toBeInTheDocument();
    expect(useDashboardMock.mock.calls.at(-1)![2]).toBeUndefined();
    expect(useSalesMock.mock.calls.at(-1)![0]).not.toHaveProperty("locationId");
  });

  it("follows the chosen site through the sales figures and the recent-sales peek", () => {
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "Todas las sedes" }));
    fireEvent.click(screen.getByRole("option", { name: "Usaquén" }));

    expect(useDashboardMock.mock.calls.at(-1)![2]).toBe("site-b");
    expect(useSalesByPaymentMethodMock.mock.calls.at(-1)![2]).toBe("site-b");
    expect(useTopSellingProductsMock.mock.calls.at(-1)![3]).toBe("site-b");
    expect(useSalesMock.mock.calls.at(-1)![0]).toMatchObject({
      locationId: "site-b",
    });
  });

  it("says which tiles stay organization-wide", () => {
    render(<DashboardPage />);

    expect(
      screen.queryByText(
        "Gastos, productos, clientes y stock crítico son de toda la organización.",
      ),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Todas las sedes" }));
    fireEvent.click(screen.getByRole("option", { name: "Usaquén" }));

    expect(
      screen.getByText(
        "Gastos, productos, clientes y stock crítico son de toda la organización.",
      ),
    ).toBeInTheDocument();
  });

  it("hides the selector for a single-site organization", () => {
    useLocationsMock.mockReturnValue({ data: [sites[0]] });

    render(<DashboardPage />);

    expect(
      screen.queryByRole("button", { name: "Todas las sedes" }),
    ).not.toBeInTheDocument();
    expect(useDashboardMock.mock.calls.at(-1)![2]).toBeUndefined();
  });
});
