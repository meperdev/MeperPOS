import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TodayStatsInner } from "./TodayStats";

const useDailySalesMock = vi.fn();
const useDashboardMock = vi.fn();
const useExpensesMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/useReports", () => ({
  useDailySales: (startDate: string, endDate: string) =>
    useDailySalesMock(startDate, endDate),
  useDashboard: () => useDashboardMock(),
}));

vi.mock("@/hooks/useExpenses", () => ({
  useExpenses: (params: unknown) => useExpensesMock(params),
}));

/**
 * KPI values render through `AnimatedNumber`, whose aria-hidden odometer strips
 * hold every digit 0-9. A bare `getByText("5")` would therefore also match the
 * strip's own "5", so value queries target the sr-only node that carries the
 * full string — the one a screen reader reads.
 */
const VALUE_SELECTOR = '[data-testid="animated-number"] .sr-only';

function daily(date: string, total: number, count: number) {
  return {
    date,
    total,
    subtotal: Math.round(total * 0.84),
    tax: total - Math.round(total * 0.84),
    count,
  };
}

describe("TodayStats (today KPIs, low-stock strip, all-time totals)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDailySalesMock.mockReturnValue({
      data: { data: [daily("2026-08-22", 250000, 5)] },
    });
    useDashboardMock.mockReturnValue({
      data: {
        totalSales: 12,
        totalProducts: 30,
        totalCustomers: 8,
        lowStockProducts: 2,
      },
    });
    useExpensesMock.mockReturnValue({
      data: { data: [{ date: "2026-08-22", total: 60000 }] },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("queries useDailySales across the 7-day KPI window ending today", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    expect(useDailySalesMock).toHaveBeenCalledWith("2026-08-16", "2026-08-22");
    expect(screen.getByText("Ventas hoy")).toBeTruthy();
  });

  it("renders the four today KPI cards in one row", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    const row1 = screen.getByTestId("kpi-row-1");
    expect(row1.querySelectorAll("[data-tone]")).toHaveLength(4);

    const row1Cards = within(row1);
    expect(row1Cards.getByText("Ventas hoy")).toBeTruthy();
    expect(row1Cards.getByText("Salidas hoy")).toBeTruthy();
    expect(row1Cards.getByText("Transacciones")).toBeTruthy();
    expect(row1Cards.getByText("Ticket promedio")).toBeTruthy();
  });

  it("shows a sparkline on every today card and none in the totals card", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    expect(
      screen
        .getByTestId("kpi-row-1")
        .querySelectorAll('[data-testid="metric-sparkline"]'),
    ).toHaveLength(4);
    expect(
      screen
        .getByTestId("kpi-totals")
        .querySelectorAll('[data-testid="metric-sparkline"]'),
    ).toHaveLength(0);
  });

  it("shows today's real sales total, transactions count and average ticket", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    expect(screen.getByText(/\$\s250\.000/, { selector: VALUE_SELECTOR })).toBeTruthy();
    expect(screen.getByText("5", { selector: VALUE_SELECTOR })).toBeTruthy();
    // Ticket promedio = 250000 / 5 = 50000
    expect(screen.getByText(/\$\s50\.000/, { selector: VALUE_SELECTOR })).toBeTruthy();
  });

  it("sums today's expenses for the Salidas hoy metric", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    expect(screen.getByText("Salidas hoy")).toBeTruthy();
    expect(screen.getByText(/\$\s60\.000/, { selector: VALUE_SELECTOR })).toBeTruthy();
  });

  it("renders the accumulated metrics as one totals card with three labelled values", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    const totals = within(screen.getByRole("region", { name: "Totales" }));

    expect(totals.getByText("Ventas completadas")).toBeTruthy();
    expect(totals.getByText("12", { selector: VALUE_SELECTOR })).toBeTruthy();
    expect(totals.getByText("Productos totales")).toBeTruthy();
    expect(totals.getByText("30", { selector: VALUE_SELECTOR })).toBeTruthy();
    expect(totals.getByText("Clientes totales")).toBeTruthy();
    expect(totals.getByText("8", { selector: VALUE_SELECTOR })).toBeTruthy();
  });

  it("sets money KPI values in tabular sans, never mono", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    // Row 1: today's sales total as money. The numeric classes live on the
    // counter root — the matched node is only the sr-only copy of the string.
    const sales = screen
      .getByText(/\$\s250\.000/, { selector: VALUE_SELECTOR })
      .closest('[data-testid="animated-number"]') as HTMLElement;
    expect(sales).toHaveClass("tabular-nums");
    expect(sales).not.toHaveClass("font-mono");

    // Totals row: a count, same rule — digits align, the face stays sans.
    const totals = within(screen.getByTestId("kpi-totals"));
    const count = totals
      .getByText("30", { selector: VALUE_SELECTOR })
      .closest('[data-testid="animated-number"]') as HTMLElement;
    expect(count).toHaveClass("tabular-nums");
    expect(count).not.toHaveClass("font-mono");
  });

  it("animates the four KPI values and the three totals, and only those", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    const row1 = screen.getByTestId("kpi-row-1");
    expect(row1.querySelectorAll('[data-testid="animated-number"]')).toHaveLength(4);

    const totals = screen.getByTestId("kpi-totals");
    // Three values roll; the low-stock cell keeps its plain "2 productos" copy.
    expect(totals.querySelectorAll('[data-testid="animated-number"]')).toHaveLength(3);
    expect(
      within(totals).getByText("2 productos").closest('[data-testid="animated-number"]'),
    ).toBeNull();
  });

  it("formats the totals values with es-CO grouping", () => {
    useDashboardMock.mockReturnValue({
      data: {
        totalSales: 1234,
        totalProducts: 5678,
        totalCustomers: 9,
        lowStockProducts: 0,
      },
    });

    render(<TodayStatsInner today="2026-08-22" />);

    const totals = within(screen.getByTestId("kpi-totals"));

    expect(totals.getByText("1.234", { selector: VALUE_SELECTOR })).toBeTruthy();
    expect(totals.getByText("5.678", { selector: VALUE_SELECTOR })).toBeTruthy();
    expect(totals.getByText("9", { selector: VALUE_SELECTOR })).toBeTruthy();
  });

  it("renders the low-stock count as a link to the low-stock inventory filter", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    const strip = screen.getByRole("link", {
      name: /2 productos en stock crítico/,
    });

    expect(strip).toHaveAttribute("href", "/inventory?filter=lowStock");
    expect(within(strip).getByText("Stock crítico")).toBeTruthy();
    expect(within(strip).getByText("2 productos")).toBeTruthy();
  });

  it("uses the singular copy for a single low-stock product", () => {
    useDashboardMock.mockReturnValue({
      data: {
        totalSales: 12,
        totalProducts: 30,
        totalCustomers: 8,
        lowStockProducts: 1,
      },
    });

    render(<TodayStatsInner today="2026-08-22" />);

    expect(
      screen.getByRole("link", { name: /1 producto en stock crítico/ }),
    ).toBeTruthy();
    expect(screen.queryByText(/1 productos/)).toBeNull();
  });

  it("does not render the low-stock strip when nothing needs reordering", () => {
    useDashboardMock.mockReturnValue({
      data: {
        totalSales: 12,
        totalProducts: 30,
        totalCustomers: 8,
        lowStockProducts: 0,
      },
    });

    render(<TodayStatsInner today="2026-08-22" />);

    expect(screen.queryByTestId("kpi-low-stock")).toBeNull();
    expect(screen.queryByText("Stock crítico")).toBeNull();
    expect(screen.getByTestId("kpi-totals")).toBeTruthy();
    expect(screen.getByTestId("kpi-totals").firstElementChild!.className).not.toContain("md:grid-cols-4");
  });

  it("puts the low-stock link as the fourth cell of the totals card instead of a full-width strip", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    const row = screen.getByTestId("kpi-row-1");
    const strip = screen.getByTestId("kpi-low-stock");
    const totals = screen.getByTestId("kpi-totals");

    expect(totals.contains(strip)).toBe(true);
    expect(strip.parentElement!.className).toContain("md:grid-cols-4");
    expect(strip.parentElement!.lastElementChild).toBe(strip);
    expect(
      row.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not surface the 30-day trends or the previous period", () => {
    useDashboardMock.mockReturnValue({
      data: {
        totalSales: 12,
        totalProducts: 30,
        totalCustomers: 8,
        lowStockProducts: 2,
        trends: { totalSales: 777, totalRevenue: 555, totalCustomers: 333 },
        previousPeriod: { revenue: 888888, sales: 444 },
      },
    });

    render(<TodayStatsInner today="2026-08-22" />);

    expect(screen.queryByText(/777|555|333|888\.888|444/)).toBeNull();
  });

  it("renders 'Sin base' when there is no real yesterday baseline", () => {
    render(<TodayStatsInner today="2026-08-22" />);

    const row1 = within(screen.getByTestId("kpi-row-1"));
    // Only today's record exists, so every row-1 delta falls back to "Sin base".
    expect(row1.getAllByText("Sin base")).toHaveLength(4);
    expect(within(screen.getByTestId("kpi-totals")).queryByText("Sin base")).toBeNull();
  });

  it("computes the delta from yesterday's real series value", () => {
    useDailySalesMock.mockReturnValue({
      data: {
        data: [daily("2026-08-21", 200000, 4), daily("2026-08-22", 250000, 5)],
      },
    });

    render(<TodayStatsInner today="2026-08-22" />);

    // Sales: (250000 - 200000) / 200000 = +25.0%
    expect(screen.getAllByText("+25.0%").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sin base")).toBeTruthy();
  });

  it("shows $0 for sales and expenses when there is no data today", () => {
    useDailySalesMock.mockReturnValue({ data: { data: [] } });
    useExpensesMock.mockReturnValue({ data: { data: [] } });

    render(<TodayStatsInner today="2026-08-22" />);

    expect(screen.getAllByText(/\$ 0/, { selector: VALUE_SELECTOR }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("0", { selector: VALUE_SELECTOR })).toBeTruthy();
  });
});
