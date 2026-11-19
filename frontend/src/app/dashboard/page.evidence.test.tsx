import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Customer, DashboardData, Sale } from "@/types";

const pushMock = vi.fn();
const useDashboardMock = vi.fn();
const useDailySalesMock = vi.fn();
const useSalesByCategoryDailyMock = vi.fn();
const useSalesByPaymentMethodMock = vi.fn();
const useTopSellingProductsMock = vi.fn();
const useExpensesMock = vi.fn();
const useTasksMock = vi.fn();
const useSalesMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useReports", () => ({
  useDashboard: () => useDashboardMock(),
  useDailySales: (startDate: string, endDate: string) =>
    useDailySalesMock(startDate, endDate),
  useSalesByCategoryDaily: (startDate: string, endDate: string) =>
    useSalesByCategoryDailyMock(startDate, endDate),
  useSalesByPaymentMethod: (startDate: string, endDate: string) =>
    useSalesByPaymentMethodMock(startDate, endDate),
  useTopSellingProducts: (startDate: string, endDate: string, limit: number) =>
    useTopSellingProductsMock(startDate, endDate, limit),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Ana Admin", role: "ADMIN" },
  }),
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

import DashboardPage from "./page";

function makeDashboardData(input: Partial<DashboardData>): DashboardData {
  return {
    totalSales: 5,
    totalRevenue: 500000,
    totalProducts: 10,
    totalCustomers: 3,
    lowStockProducts: 1,
    trends: {
      totalSales: 2,
      totalRevenue: 5,
      totalCustomers: 1,
    },
    previousPeriod: {
      revenue: 400000,
      sales: 4,
    },
    recentSales: [
      {
        id: "sale-1",
        saleNumber: 101,
        total: 50000,
        status: "COMPLETED",
        createdAt: "2026-01-01T12:00:00.000Z",
        customer: { id: "customer-1", name: "Cliente Uno" },
        items: [
          {
            id: "item-1",
            quantity: 1,
            total: 50000,
            product: { id: "product-1", name: "Producto Uno" },
          },
        ],
      },
    ],
    appliedRange: {
      startDate: "2026-01-01",
      endDate: "2026-01-07",
      timezone: "America/Bogota",
    },
    ...input,
  };
}

function makeCustomer(): Customer {
  return {
    id: "customer-1",
    name: "Cliente Uno",
    documentType: "CC",
    documentNumber: "123456",
    email: null,
    phone: null,
    address: null,
    referencia: null,
    placaMoto: null,
    segment: "OCCASIONAL",
    active: true,
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
  };
}

function makeSale(): Sale {
  return {
    id: "sale-1",
    saleNumber: 101,
    customerId: "customer-1",
    customer: makeCustomer(),
    subtotal: 42000,
    taxAmount: 8000,
    discountAmount: 0,
    total: 50000,
    amountPaid: 50000,
    change: 0,
    status: "COMPLETED",
    userId: "user-1",
    items: [],
    payments: [
      {
        id: "payment-1",
        saleId: "sale-1",
        method: "CASH",
        amount: 50000,
        createdAt: "2026-01-01T12:00:00.000Z",
      },
    ],
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
  };
}

describe("Dashboard scope evidence (DIA-4/13/10 — reports no longer duplicated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useDailySalesMock.mockReturnValue({
      data: {
        data: [
          { date: "2026-01-01", total: 50000, subtotal: 42000, tax: 8000, count: 1 },
        ],
      },
    });

    useSalesByCategoryDailyMock.mockReturnValue({
      data: {
        data: [
          { date: "2026-01-01", category: "Bebidas", total: 50000, quantity: 1 },
        ],
        appliedRange: {
          startDate: "2026-01-01",
          endDate: "2026-01-07",
          timezone: "America/Bogota",
        },
      },
    });

    useDashboardMock.mockReturnValue({
      data: makeDashboardData({}),
      isLoading: false,
      error: null,
    });

    useSalesByPaymentMethodMock.mockReturnValue({
      data: {
        data: [
          { paymentMethod: "CASH", total: 30000, subtotal: 0, count: 1 },
          { paymentMethod: "CARD", total: 20000, subtotal: 0, count: 1 },
          { paymentMethod: "TRANSFER", total: 10000, subtotal: 0, count: 1 },
        ],
      },
    });

    useTopSellingProductsMock.mockReturnValue({
      data: {
        data: [
          {
            productId: "p-1",
            productName: "Producto Estrella",
            quantity: 4,
            total: 20000,
            stock: 9,
          },
        ],
      },
    });

    useExpensesMock.mockReturnValue({ data: { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } } });
    useTasksMock.mockReturnValue({ data: { tasks: [], source: "remote" } });
    useSalesMock.mockReturnValue({ data: { data: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the today KPI row, the low-stock strip, the totals card and the compact panels", () => {
    render(<DashboardPage />);

    // Today KPIs — four cards with sparkline and delta
    expect(screen.getByText("Ventas hoy")).toBeTruthy();
    expect(screen.getByText("Salidas hoy")).toBeTruthy();
    expect(screen.getByText("Transacciones")).toBeTruthy();
    expect(screen.getByText("Ticket promedio")).toBeTruthy();

    // All-time totals — one card with three divided cells
    expect(screen.getByText("Ventas completadas")).toBeTruthy();
    expect(screen.getByText("Productos totales")).toBeTruthy();
    expect(screen.getByText("Clientes totales")).toBeTruthy();

    // Stock crítico is an action cell inside the totals card, not a full-width strip
    const lowStock = screen.getByRole("link", { name: /1 producto en stock crítico/i });
    expect(screen.getByRole("region", { name: "Totales" }).contains(lowStock)).toBe(true);

    // Compact operational panels (low-stock is no longer duplicated here)
    expect(screen.queryByText("Stock bajo")).toBeNull();
    expect(screen.getByText("Gastos por pagar")).toBeTruthy();
    expect(screen.getByText("Tareas abiertas")).toBeTruthy();
  });

  it("renders the recent-sales section between revenue and the alert panels", () => {
    useSalesMock.mockReturnValue({ data: { data: [makeSale()] } });

    render(<DashboardPage />);

    expect(screen.getByText("Ventas recientes")).toBeTruthy();
    expect(screen.getByRole("link", { name: /ver todas/i })).toHaveAttribute(
      "href",
      "/sales",
    );
    expect(screen.getByTestId("recent-sale-row")).toBeTruthy();
  });

  it("renders the revenue piece with its default 7-day range", () => {
    render(<DashboardPage />);

    expect(screen.getByText("Ingresos por categoría")).toBeTruthy();
    // Default range is a rolling 7 days, so the chart renders 7 bar slots.
    expect(screen.getByTestId("category-stacked-chart")).toHaveAttribute(
      "data-day-count",
      "7",
    );
    expect(screen.getByTestId("payment-methods-card")).toBeTruthy();
    expect(screen.getByTestId("top-products-card")).toBeTruthy();
  });

  it("does not render a hardcoded sales goal, a fake curve or mislabeled 'Ayer vs Hoy' (DIA-4/DIA-13)", () => {
    render(<DashboardPage />);

    expect(screen.queryByText(/1,500/)).toBeNull();
    expect(screen.queryByText(/Meta:/)).toBeNull();
    expect(screen.queryByText("Ayer vs Hoy")).toBeNull();
    expect(screen.queryByText(/Q50,70/)).toBeNull();
  });

  it("does not render the historical reports sections nor the sold-products table (DIA-10)", () => {
    render(<DashboardPage />);

    expect(screen.queryByText("Productos Vendidos")).toBeNull();
    expect(screen.queryByText("Productos Más Vendidos")).toBeNull();
    expect(screen.queryByText("Economía")).toBeNull();
    expect(screen.queryByText("Caja y pagos")).toBeNull();
    expect(screen.queryByText("Top Clientes")).toBeNull();
    expect(screen.queryByText("Categorías")).toBeNull();
    expect(screen.queryByText("Inventario actual")).toBeNull();
  });

  it("links the low-stock strip to the low-stock inventory filter", () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole("link", { name: /1 producto en stock crítico/i }),
    ).toHaveAttribute("href", "/inventory?filter=lowStock");
  });
});
