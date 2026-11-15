import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CategoryDayDetailModal,
  CategoryStackedChart,
  CategoryTooltipContent,
} from "./CategoryStackedChart";
import type { SaleByCategoryDaily } from "@/types";

const useSalesByCategoryDailyMock = vi.fn();

vi.mock("@/hooks/useReports", () => ({
  useSalesByCategoryDaily: (startDate: string, endDate: string) =>
    useSalesByCategoryDailyMock(startDate, endDate),
}));

const rows: SaleByCategoryDaily[] = [
  { date: "2026-08-21", category: "Bebidas", total: 100000, quantity: 2 },
  { date: "2026-08-21", category: "Snacks", total: 50000, quantity: 1 },
  { date: "2026-08-22", category: "Bebidas", total: 25000, quantity: 1 },
];

describe("CategoryStackedChart (Recharts stacked by category)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSalesByCategoryDailyMock.mockReturnValue({ data: { data: rows } });
  });

  afterEach(() => {
    cleanup();
  });

  it("fetches its own window from the range props", () => {
    render(<CategoryStackedChart startDate="2026-08-16" endDate="2026-08-22" />);

    expect(useSalesByCategoryDailyMock).toHaveBeenCalledWith(
      "2026-08-16",
      "2026-08-22",
    );
  });

  it("renders one bar slot per day, including days with no sales", () => {
    render(<CategoryStackedChart startDate="2026-08-16" endDate="2026-08-22" />);

    // 7 days in the window, only 2 have rows — every day still gets a slot.
    expect(screen.getByTestId("category-stacked-chart")).toHaveAttribute(
      "data-day-count",
      "7",
    );
  });

  it("shows a range-driven title instead of a hardcoded month", () => {
    const { unmount } = render(
      <CategoryStackedChart startDate="2026-08-16" endDate="2026-08-22" />,
    );
    expect(screen.getByTestId("category-chart-title").textContent).toBe(
      "Ingresos por categoría",
    );
    expect(screen.getByTestId("category-chart-range").textContent).toBe(
      "Últimos 7 días",
    );
    expect(screen.queryByText(/Ingresos de agosto/)).toBeNull();
    unmount();

    render(<CategoryStackedChart startDate="2026-08-08" endDate="2026-08-22" />);
    expect(screen.getByTestId("category-chart-range").textContent).toBe(
      "Últimos 15 días",
    );
  });

  it("labels the x-axis with real dates, not a month-bound modulo", () => {
    const { container } = render(
      <CategoryStackedChart startDate="2026-08-16" endDate="2026-08-22" />,
    );

    const ticks = Array.from(
      container.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value"),
    ).map((node) => node.textContent);

    // First tick always carries the month; later same-month ticks are bare days.
    expect(ticks[0]).toBe("16 ago");
    expect(ticks).toContain("22");
  });

  it("thins a 30-day x-axis to a readable subset that still names the month change", () => {
    const { container } = render(
      <CategoryStackedChart startDate="2026-10-17" endDate="2026-11-15" />,
    );

    const ticks = Array.from(
      container.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value"),
    ).map((node) => node.textContent);

    // jsdom has no layout, so the chart keeps its 500px default width.
    expect(ticks.length).toBeLessThanOrEqual(12);
    expect(ticks[0]).toBe("17 oct");
    expect(ticks).toContain("1 nov");
  });

  it("keeps x-axis labels horizontal (no rotation)", () => {
    const { container } = render(
      <CategoryStackedChart startDate="2026-08-01" endDate="2026-08-30" />,
    );

    const tickTexts = Array.from(
      container.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value"),
    );
    expect(tickTexts.length).toBeGreaterThan(0);
    for (const node of tickTexts) {
      expect(node.getAttribute("transform") ?? "").not.toMatch(/rotate/);
    }
  });
});

describe("CategoryTooltipContent (Recharts custom tooltip)", () => {
  it("shows the day total plus the per-category breakdown", () => {
    render(
      <CategoryTooltipContent
        active
        payload={[
          {
            dataKey: "Bebidas",
            name: "Bebidas",
            value: 100000,
            color: "#C25E36",
            payload: {
              date: "2026-08-21",
              total: 150000,
              Bebidas: 100000,
              Snacks: 50000,
            },
          },
          {
            dataKey: "Snacks",
            name: "Snacks",
            value: 50000,
            color: "#3B82F6",
            payload: {
              date: "2026-08-21",
              total: 150000,
              Bebidas: 100000,
              Snacks: 50000,
            },
          },
        ]}
      />,
    );

    expect(screen.getByTestId("category-tooltip")).toBeTruthy();
    expect(screen.getByText(/21 de ago/)).toBeTruthy();
    expect(screen.getByText(/\$\s150\.000/)).toBeTruthy();
    expect(screen.getByText("Bebidas")).toBeTruthy();
    expect(screen.getByText("Snacks")).toBeTruthy();
  });

  it("renders nothing until the tooltip is active", () => {
    render(<CategoryTooltipContent active={false} payload={[]} />);

    expect(screen.queryByTestId("category-tooltip")).toBeNull();
  });
});

describe("CategoryDayDetailModal", () => {
  const day = {
    date: "2026-08-21",
    total: 150000,
    segments: [
      { category: "Bebidas", total: 100000, quantity: 4 },
      { category: "Snacks", total: 50000, quantity: 2 },
    ],
  };
  const colorMap = new Map([
    ["Bebidas", "#C25E36"],
    ["Snacks", "#2563EB"],
  ]);

  it("renders full category breakdown and total for the clicked day", () => {
    const onClose = vi.fn();
    render(
      <CategoryDayDetailModal day={day} onClose={onClose} colorMap={colorMap} />,
    );

    expect(screen.getByTestId("category-day-detail-modal")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/\$\s150\.000/)).toBeTruthy();
    expect(screen.getByText(/6 unidades/)).toBeTruthy();
    expect(screen.getByText("Bebidas")).toBeTruthy();
    expect(screen.getByText("Snacks")).toBeTruthy();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <CategoryDayDetailModal day={day} onClose={onClose} colorMap={colorMap} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when day is null", () => {
    render(<CategoryDayDetailModal day={null} onClose={vi.fn()} colorMap={colorMap} />);
    expect(screen.queryByTestId("category-day-detail-modal")).toBeNull();
  });
});
