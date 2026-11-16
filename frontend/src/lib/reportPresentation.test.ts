import { describe, expect, it } from "vitest";
import {
  adaptiveReportGranularity,
  dailyReportPendingItems,
  dailyReportSalesRows,
  formatReportClockTime,
  formatReportDayLabel,
  safeDecimalNumber,
} from "./reportPresentation";
import type { DailyReport } from "@/types";

describe("report presentation contract", () => {
  it("converts valid Decimal strings only for display", () => {
    expect(safeDecimalNumber("100000.25")).toBe(100000.25);
    expect(safeDecimalNumber("not-a-decimal")).toBe(0);
  });

  it("uses daily buckets for short ranges and monthly buckets for long ranges", () => {
    expect(adaptiveReportGranularity("2026-01-01", "2026-01-12")).toBe("day");
    expect(adaptiveReportGranularity("2026-01-01", "2026-06-30")).toBe("month");
  });
});

type DailyReportSlices = Pick<DailyReport, "lowStock" | "purchaseOrders" | "loans" | "sales">;

function dailyReportSlices(overrides: Partial<DailyReportSlices> = {}): DailyReportSlices {
  return { lowStock: [], purchaseOrders: [], loans: [], sales: [], ...overrides };
}

const lowStockProduct = (index: number) => ({
  id: `low-${index}`,
  name: `Producto ${index}`,
  sku: `SKU-${index}`,
  type: "PRODUCT",
  tracksStock: true,
  stock: index,
  minStock: 10,
});

describe("daily report presentation", () => {
  it("formats the cutoff in Bogotá time and names the report day in Spanish", () => {
    expect(formatReportClockTime("2026-03-15T18:42:00.000Z")).toBe("13:42");
    expect(formatReportClockTime(null)).toBe("—");
    expect(formatReportDayLabel("2026-03-15")).toBe("15 de marzo");
  });

  it("keeps only the pending groups that have work, with a three-item sample", () => {
    const items = dailyReportPendingItems(
      dailyReportSlices({
        lowStock: [0, 1, 2, 3, 4, 5, 6].map(lowStockProduct),
        loans: [
          {
            id: "loan-1",
            type: "MONEY",
            amount: "50000.00",
            balance: "20000.00",
            dueAt: "2026-03-10",
            reason: "Préstamo",
            customer: "Cliente Uno",
            supplier: null,
          },
        ],
      }),
    );

    expect(items.map((item) => item.key)).toEqual(["lowStock", "loans"]);
    expect(items[0]).toMatchObject({
      label: "Productos con stock bajo",
      href: "/inventory",
      count: 7,
      remaining: 4,
    });
    expect(items[0].sample).toEqual([
      "Producto 0 · 0 en stock",
      "Producto 1 · 1 en stock",
      "Producto 2 · 2 en stock",
    ]);
    expect(items[1]).toMatchObject({
      label: "Préstamos vencidos o por vencer",
      href: "/loans",
      count: 1,
      remaining: 0,
    });
    expect(items[1].sample[0]).toContain("Cliente Uno");
  });

  it("collapses a day without pending work into no rows at all", () => {
    expect(dailyReportPendingItems(dailyReportSlices())).toEqual([]);
  });

  it("lists today's sales newest first and names the walk-in bucket", () => {
    const rows = dailyReportSalesRows([
      {
        id: "sale-1",
        saleNumber: 40,
        createdAt: "2026-03-15T14:05:00.000Z",
        total: "45000.00",
        customer: null,
        items: [],
      },
      {
        id: "sale-2",
        saleNumber: 41,
        createdAt: "2026-03-15T18:42:00.000Z",
        total: "120000.00",
        customer: { name: "Cliente Uno", documentNumber: "123" },
        items: [],
      },
    ]);

    expect(rows).toEqual([
      { id: "sale-2", saleNumber: 41, time: "13:42", customerLabel: "Cliente Uno", total: "120000.00" },
      { id: "sale-1", saleNumber: 40, time: "09:05", customerLabel: "Sin cliente", total: "45000.00" },
    ]);
  });
});
