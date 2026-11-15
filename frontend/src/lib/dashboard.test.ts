import { describe, expect, it } from "vitest";
import {
  buildCategoryColorMap,
  CATEGORY_CHART_PALETTE,
  buildDailyMetricSeries,
  buildDateWindow,
  buildStackedDailySeries,
  chartHeight,
  computeDelta,
  computePendingAmount,
  computeTodayMetrics,
  countDaysInclusive,
  DASHBOARD_RANGES,
  DEFAULT_DASHBOARD_RANGE,
  filterOpenTasks,
  formatCategoryAmountTick,
  formatCategoryTooltipDate,
  formatChartDayTicks,
  getDashboardRange,
  pickChartDayTicks,
  resolveDashboardRange,
  sumExpensesOnDate,
} from "./dashboard";
import type { TaskStatus } from "@/types";

describe("computeTodayMetrics (DIA-1/DIA-2)", () => {
  it("returns sales, count and a non-zero average ticket when count > 0", () => {
    expect(computeTodayMetrics({ total: 250000, count: 5 })).toEqual({
      sales: 250000,
      transactions: 5,
      ticket: 50000,
    });
  });

  it("returns a zero ticket when count is 0 without dividing by zero", () => {
    expect(computeTodayMetrics({ total: 50000, count: 0 })).toEqual({
      sales: 50000,
      transactions: 0,
      ticket: 0,
    });
  });

  it("returns all-zero metrics when the record is missing", () => {
    expect(computeTodayMetrics(undefined)).toEqual({
      sales: 0,
      transactions: 0,
      ticket: 0,
    });
  });
});

describe("computePendingAmount (DIA-7)", () => {
  it("subtracts the sum of payments from the expense total", () => {
    expect(
      computePendingAmount({
        total: 100000,
        payments: [{ amount: 40000 }, { amount: 30000 }],
      }),
    ).toBe(30000);
  });

  it("falls back to the full total when payments is empty", () => {
    expect(computePendingAmount({ total: 100000, payments: [] })).toBe(100000);
  });

  it("falls back to the full total when payments are absent", () => {
    expect(computePendingAmount({ total: 100000 })).toBe(100000);
  });

  it("coerces the decimal strings the API sends before subtracting", () => {
    expect(
      computePendingAmount({
        total: "100000",
        payments: [{ amount: "40000" }, { amount: "30000" }],
      }),
    ).toBe(30000);
  });
});

describe("filterOpenTasks (DIA-8)", () => {
  it("keeps only PENDING/IN_PROGRESS tasks and drops COMPLETED/CANCELLED", () => {
    const tasks = [
      { status: "PENDING" as const },
      { status: "COMPLETED" as const },
      { status: "IN_PROGRESS" as const },
      { status: "CANCELLED" as const },
    ];

    expect(filterOpenTasks(tasks)).toEqual([
      { status: "PENDING" },
      { status: "IN_PROGRESS" },
    ]);
  });

  it("caps the open-task list to five entries", () => {
    const tasks: Array<{ status: TaskStatus }> = Array.from(
      { length: 8 },
      (_, index) => ({
        status: index % 2 === 0 ? "PENDING" : "IN_PROGRESS",
      }),
    );

    expect(filterOpenTasks(tasks)).toHaveLength(5);
  });
});

describe("chartHeight (DIA-11)", () => {
  it("uses the minimum visible height for a zero-total day", () => {
    expect(chartHeight(0, 100)).toBe(18);
  });

  it("scales a non-zero total proportionally to the max", () => {
    expect(chartHeight(50, 100)).toBe(50);
    expect(chartHeight(100, 100)).toBe(100);
  });

  it("respects the minimum visible height for small totals", () => {
    expect(chartHeight(25, 100)).toBe(28);
  });

  it("returns the minimum height without a measurable max", () => {
    expect(chartHeight(50, 0)).toBe(18);
  });
});

describe("buildCategoryColorMap (stacked chart)", () => {
  it("assigns a stable color per category ordered by name", () => {
    const map = buildCategoryColorMap(["Bebidas", "Snacks", "Bebidas"]);
    expect(map.get("Bebidas")).toBe(map.get("Bebidas"));
    expect(map.get("Bebidas")).not.toBe(map.get("Snacks"));
  });

  it("de-duplicates category names", () => {
    const map = buildCategoryColorMap(["A", "A", "B"]);
    expect(map.size).toBe(2);
  });

  it("exposes the palette as the eight chart CSS variables, never literal colors", () => {
    expect(CATEGORY_CHART_PALETTE).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
      "var(--chart-6)",
      "var(--chart-7)",
      "var(--chart-8)",
    ]);
  });

  it("assigns colors by sorted category name, independent of input order", () => {
    const forward = buildCategoryColorMap(["Snacks", "Bebidas", "Aseo"]);
    const reverse = buildCategoryColorMap(["Aseo", "Bebidas", "Snacks"]);
    expect(forward.get("Aseo")).toBe("var(--chart-1)");
    expect(forward.get("Bebidas")).toBe("var(--chart-2)");
    expect(forward.get("Snacks")).toBe("var(--chart-3)");
    expect([...reverse.entries()]).toEqual([...forward.entries()]);
  });

  it("wraps the palette after eight categories", () => {
    const names = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"];
    const map = buildCategoryColorMap(names);
    expect(map.get("c8")).toBe("var(--chart-8)");
    expect(map.get("c9")).toBe("var(--chart-1)");
  });
});

describe("buildStackedDailySeries (stacked chart)", () => {
  const days = ["2026-08-20", "2026-08-21", "2026-08-22"];

  it("groups rows into one day slot per requested day", () => {
    const series = buildStackedDailySeries(
      [
        { date: "2026-08-21", category: "Bebidas", total: 100, quantity: 2 },
        { date: "2026-08-21", category: "Snacks", total: 50, quantity: 1 },
      ],
      days,
    );

    expect(series).toHaveLength(3);
    expect(series[0]).toEqual({ date: "2026-08-20", segments: [], total: 0 });
    expect(series[1].date).toBe("2026-08-21");
    expect(series[1].total).toBe(150);
    expect(series[1].segments).toEqual([
      { category: "Bebidas", total: 100, quantity: 2 },
      { category: "Snacks", total: 50, quantity: 1 },
    ]);
    expect(series[2]).toEqual({ date: "2026-08-22", segments: [], total: 0 });
  });

  it("aggregates repeated rows into a single segment per category", () => {
    const series = buildStackedDailySeries(
      [
        { date: "2026-08-21", category: "Bebidas", total: 100, quantity: 2 },
        { date: "2026-08-21", category: "Bebidas", total: 25, quantity: 1 },
      ],
      days,
    );

    expect(series[1].segments).toHaveLength(1);
    expect(series[1].segments[0]).toEqual({
      category: "Bebidas",
      total: 125,
      quantity: 3,
    });
  });
});

describe("sumExpensesOnDate (Salidas hoy)", () => {
  const today = "2026-08-22";

  it("sums only the expenses on the given date", () => {
    expect(
      sumExpensesOnDate(
        [
          { date: "2026-08-22", total: 120000 },
          { date: "2026-08-21", total: 50000 },
        ],
        today,
      ),
    ).toBe(120000);
  });

  it("accepts ISO timestamps by matching the first 10 characters", () => {
    expect(
      sumExpensesOnDate(
        [{ date: "2026-08-22T05:00:00.000Z", total: 30000 }],
        today,
      ),
    ).toBe(30000);
  });

  it("returns 0 when the list is empty or undefined", () => {
    expect(sumExpensesOnDate([], today)).toBe(0);
    expect(sumExpensesOnDate(undefined, today)).toBe(0);
  });

  it("sums the decimal strings the API sends instead of concatenating them", () => {
    expect(
      sumExpensesOnDate(
        [
          { date: "2026-08-22", total: "120000" },
          { date: "2026-08-22T05:00:00.000Z", total: "5000" },
          { date: "2026-08-21", total: "90000" },
        ],
        today,
      ),
    ).toBe(125000);
  });
});

describe("formatCategoryAmountTick", () => {
  it("keeps every money tick to one short token", () => {
    expect(formatCategoryAmountTick(18_000_000)).toBe("$18M");
    expect(formatCategoryAmountTick(6_000_000)).toBe("$6M");
    expect(formatCategoryAmountTick(450_000)).toBe("$450k");
    expect(formatCategoryAmountTick(900)).toBe("$900");
    expect(formatCategoryAmountTick(0)).toBe("");
  });
});

describe("buildDateWindow (dashboard KPI window)", () => {
  it("returns an inclusive, oldest → newest window ending today", () => {
    expect(buildDateWindow("2026-08-22", 8)).toEqual([
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ]);
  });

  it("crosses a month boundary correctly", () => {
    expect(buildDateWindow("2026-03-02", 4)).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("returns an empty list for a non-positive length", () => {
    expect(buildDateWindow("2026-08-22", 0)).toEqual([]);
  });
});

describe("dashboard range helpers", () => {
  it("exposes the three range descriptors with labels and day counts", () => {
    expect(DASHBOARD_RANGES.map((range) => range.key)).toEqual([
      "7d",
      "15d",
      "1m",
    ]);
    expect(DASHBOARD_RANGES.map((range) => range.label)).toEqual([
      "7 días",
      "15 días",
      "1 mes",
    ]);
    expect(DASHBOARD_RANGES.map((range) => range.days)).toEqual([7, 15, 30]);
    expect(DEFAULT_DASHBOARD_RANGE).toBe("7d");
  });

  it("falls back to the default range for an unknown key", () => {
    expect(getDashboardRange("7d").days).toBe(7);
    // @ts-expect-error deliberately unknown key
    expect(getDashboardRange("nope").key).toBe("7d");
  });

  it("resolves each range into an inclusive window ending today", () => {
    expect(resolveDashboardRange("7d", "2026-08-22")).toEqual({
      startDate: "2026-08-16",
      endDate: "2026-08-22",
    });
    expect(resolveDashboardRange("15d", "2026-08-22")).toEqual({
      startDate: "2026-08-08",
      endDate: "2026-08-22",
    });
    // 1m is a rolling 30-day window, not a calendar month.
    expect(resolveDashboardRange("1m", "2026-08-22")).toEqual({
      startDate: "2026-07-24",
      endDate: "2026-08-22",
    });
  });

  it("counts inclusive days between two dates and crosses month boundaries", () => {
    expect(countDaysInclusive("2026-08-16", "2026-08-22")).toBe(7);
    expect(countDaysInclusive("2026-02-27", "2026-03-02")).toBe(4);
    expect(countDaysInclusive("2026-08-22", "2026-08-22")).toBe(1);
  });

  describe("pickChartDayTicks (x-axis tick selection)", () => {
    const series = (start: string, length: number): string[] => {
      const [y, m, d] = start.split("-").map(Number);
      return Array.from({ length }, (_, i) => {
        const date = new Date(Date.UTC(y, m - 1, d + i, 12));
        return date.toISOString().slice(0, 10);
      });
    };

    it("labels every date when the window is narrow and short", () => {
      const week = series("2026-08-16", 7);
      expect(pickChartDayTicks(week, 350)).toEqual(week);
    });

    it("thins a 30-day window at 350px to 7 labels, first and last included", () => {
      const month = series("2026-10-17", 30);
      const picked = pickChartDayTicks(month, 350);

      // target = floor(350 / 44) = 7 → step = ceil(30 / 7) = 5
      expect(picked).toHaveLength(7);
      expect(picked[0]).toBe("2026-10-17");
      expect(picked[picked.length - 1]).toBe("2026-11-15");
    });

    it("drops the previous pick when it would crowd the last date", () => {
      // 32 dates, step 5: the naive pick at index 30 sits one day from index 31.
      const dates = series("2026-10-01", 32);
      const picked = pickChartDayTicks(dates, 350);

      expect(picked.at(-2)).toBe(dates[25]);
      expect(picked.at(-1)).toBe(dates[31]);
      expect(picked).not.toContain(dates[30]);
    });

    it("keeps the first tick of a new month even when the 1st is not picked", () => {
      // 30 dates at 360px → step 4, so 2026-11-01 (index 15) is skipped.
      const month = series("2026-10-17", 30);
      const picked = pickChartDayTicks(month, 360);
      const labels = formatChartDayTicks(picked);

      expect(picked).not.toContain("2026-11-01");
      expect(labels.get("2026-11-02")).toBe("2 nov");
    });

    it("falls back to 7 labels when the width is unknown and the window is long", () => {
      expect(pickChartDayTicks(series("2026-10-17", 30), 0)).toHaveLength(7);
    });

    it("labels every date when the width is unknown and the window is 7 days or less", () => {
      const week = series("2026-08-16", 7);
      expect(pickChartDayTicks(week, 0)).toEqual(week);
    });

    it("returns an empty list for an empty window and the lone date for a single day", () => {
      expect(pickChartDayTicks([], 500)).toEqual([]);
      expect(pickChartDayTicks(["2026-08-16"], 500)).toEqual(["2026-08-16"]);
    });
  });

  describe("formatChartDayTicks (x-axis labels)", () => {
    it("shows the month on the first tick and bare days within a month", () => {
      const labels = formatChartDayTicks(["2026-08-21", "2026-08-26"]);

      expect(labels.get("2026-08-21")).toBe("21 ago");
      expect(labels.get("2026-08-26")).toBe("26");
    });

    it("shows the month again when a picked tick changes month", () => {
      const labels = formatChartDayTicks([
        "2026-08-21",
        "2026-08-26",
        "2026-09-01",
        "2026-09-06",
      ]);

      expect(labels.get("2026-09-01")).toBe("1 sep");
      expect(labels.get("2026-09-06")).toBe("6");
    });

    it("compares against the previous picked tick, not the previous calendar day", () => {
      // Picks skip Oct 31 and Nov 1; Nov 4 is the first picked tick of November.
      const labels = formatChartDayTicks(["2026-10-29", "2026-11-04", "2026-11-08"]);

      expect(labels.get("2026-11-04")).toBe("4 nov");
      expect(labels.get("2026-11-08")).toBe("8");
    });

    it("uses lowercase short es-CO month names without a trailing dot", () => {
      const labels = formatChartDayTicks(["2026-01-05", "2026-11-01", "2026-12-31"]);

      expect(labels.get("2026-01-05")).toBe("5 ene");
      expect(labels.get("2026-11-01")).toBe("1 nov");
      expect(labels.get("2026-12-31")).toBe("31 dic");
    });

    it("parses the ISO string without a timezone shift", () => {
      // new Date("2026-08-01") is UTC midnight, which is Jul 31 in Bogotá.
      expect(formatChartDayTicks(["2026-08-01"]).get("2026-08-01")).toBe("1 ago");
    });

    it("returns the input unchanged when it is not a date", () => {
      expect(formatChartDayTicks(["nope"]).get("nope")).toBe("nope");
    });
  });

  it("formats a readable tooltip date", () => {
    expect(formatCategoryTooltipDate("2026-08-21")).toBe("21 de ago");
  });
});

describe("buildDailyMetricSeries (sparkline series)", () => {
  const days = ["2026-08-20", "2026-08-21", "2026-08-22"];

  it("aligns one value per requested day, oldest → newest", () => {
    const series = buildDailyMetricSeries(
      [
        { date: "2026-08-22", total: 300, subtotal: 0, tax: 0, count: 3 },
        { date: "2026-08-20", total: 100, subtotal: 0, tax: 0, count: 1 },
      ],
      days,
      (record) => record.total,
    );

    expect(series).toEqual([100, 0, 300]);
  });

  it("defaults missing days to 0 instead of dropping them", () => {
    const series = buildDailyMetricSeries(undefined, days, (record) => record.count);

    expect(series).toEqual([0, 0, 0]);
    expect(series).toHaveLength(days.length);
  });

  it("supports any per-record projection (e.g. the average ticket)", () => {
    const series = buildDailyMetricSeries(
      [{ date: "2026-08-22", total: 250000, subtotal: 0, tax: 0, count: 5 }],
      ["2026-08-22"],
      (record) => computeTodayMetrics(record).ticket,
    );

    expect(series).toEqual([50000]);
  });
});

describe("computeDelta (today vs yesterday)", () => {
  it("returns a positive percentage when the current value grows", () => {
    expect(computeDelta(250000, 200000)).toEqual({ percentage: 25 });
  });

  it("returns a negative percentage when the current value shrinks", () => {
    expect(computeDelta(150, 200)).toEqual({ percentage: -25 });
  });

  it("returns a null percentage when the baseline is 0 (never invents a delta)", () => {
    expect(computeDelta(250000, 0)).toEqual({ percentage: null });
  });

  it("returns a null percentage when the baseline is missing", () => {
    expect(computeDelta(250000, undefined)).toEqual({ percentage: null });
    expect(computeDelta(250000, null)).toEqual({ percentage: null });
  });
});
