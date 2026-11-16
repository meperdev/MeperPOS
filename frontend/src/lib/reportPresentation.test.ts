import { describe, expect, it } from "vitest";
import {
  activeReportPeriodPresetId,
  adaptiveReportGranularity,
  categoryShares,
  customerRanking,
  dailyReportPendingItems,
  dailyReportSalesRows,
  formatReportClockTime,
  formatReportDayLabel,
  normalizeReportPeriod,
  reportPeriodPresets,
  safeDecimalNumber,
  topProductsByGrossProfit,
  visiblePaymentMethods,
} from "./reportPresentation";
import type { DailyReport, FinancialProductMargin } from "@/types";

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

type DailyReportSlices = Pick<
  DailyReport,
  "date" | "lowStock" | "purchaseOrders" | "loans" | "sales"
>;

function dailyReportSlices(overrides: Partial<DailyReportSlices> = {}): DailyReportSlices {
  return {
    date: "2026-03-15",
    lowStock: [],
    purchaseOrders: [],
    loans: [],
    sales: [],
    ...overrides,
  };
}

function loan(overrides: Partial<DailyReportSlices["loans"][number]>) {
  return {
    id: "loan-1",
    type: "MONEY",
    amount: "50000.00",
    balance: "20000.00",
    dueAt: "2026-03-10",
    reason: "Préstamo",
    customer: "Cliente Uno",
    supplier: null,
    ...overrides,
  };
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

describe("daily report pending chips", () => {
  it("keeps only the groups that have work, with three chips and the rest as a count", () => {
    const groups = dailyReportPendingItems(
      dailyReportSlices({
        lowStock: [0, 1, 2, 3, 4, 5, 6].map(lowStockProduct),
        loans: [loan({})],
      }),
    );

    expect(groups.map((group) => group.key)).toEqual(["lowStock", "loans"]);
    expect(groups[0]).toMatchObject({
      label: "Productos con stock bajo",
      href: "/inventory?filter=lowStock",
      count: 7,
      remaining: 4,
    });
    expect(groups[0].chips).toEqual([
      { id: "low-0", label: "Producto 0", value: "0 / mín 10", severity: "danger" },
      { id: "low-1", label: "Producto 1", value: "1 / mín 10", severity: "warning" },
      { id: "low-2", label: "Producto 2", value: "2 / mín 10", severity: "warning" },
    ]);
    expect(groups[1]).toMatchObject({
      label: "Préstamos vencidos o por vencer",
      href: "/loans",
      count: 1,
      remaining: 0,
    });
    expect(groups[1].chips[0]).toMatchObject({
      label: expect.stringContaining("Cliente Uno"),
      value: "venció 10 mar",
      severity: "danger",
    });
  });

  it("marks an out-of-stock product as danger even when the minimum is zero", () => {
    const [group] = dailyReportPendingItems(
      dailyReportSlices({
        lowStock: [{ ...lowStockProduct(0), stock: -2, minStock: 0 }],
      }),
    );

    expect(group.chips[0]).toMatchObject({ value: "-2 / mín 0", severity: "danger" });
  });

  it("names the order status and links pending purchase orders to the open list", () => {
    const [group] = dailyReportPendingItems(
      dailyReportSlices({
        purchaseOrders: [
          {
            id: "po-1",
            orderNumber: 12,
            status: "PENDING",
            total: "90000.00",
            supplier: { name: "Proveedor Uno" },
          },
          {
            id: "po-2",
            orderNumber: 13,
            status: "PARTIAL_RECEIVED",
            total: "40000.00",
            supplier: null,
          },
        ] as DailyReportSlices["purchaseOrders"],
      }),
    );

    expect(group).toMatchObject({
      key: "purchaseOrders",
      href: "/purchase-orders?status=OPEN",
      count: 2,
    });
    expect(group.chips).toEqual([
      { id: "po-1", label: "#12 · Proveedor Uno", value: "Pendiente", severity: "warning" },
      { id: "po-2", label: "#13 · Sin proveedor", value: "Parcial", severity: "info" },
    ]);
  });

  it("separates an overdue loan from one that is due soon", () => {
    const chips = dailyReportPendingItems(
      dailyReportSlices({
        loans: [
          loan({ id: "past", dueAt: "2026-03-10T00:00:00.000Z" }),
          loan({ id: "tomorrow", dueAt: "2026-03-16", customer: null, supplier: "Proveedor" }),
          loan({ id: "later", dueAt: "2026-11-18" }),
        ],
      }),
    )[0].chips;

    expect(chips.map(({ id, value, severity }) => ({ id, value, severity }))).toEqual([
      { id: "past", value: "venció 10 mar", severity: "danger" },
      { id: "tomorrow", value: "vence 16 mar", severity: "warning" },
      { id: "later", value: "vence 18 nov", severity: "warning" },
    ]);
    // The holder leads the chip and the balance the server sent follows it.
    // `formatCurrency` separates the symbol with a non-breaking space.
    expect(chips.map((chip) => chip.label.replace(/\u00a0/g, " "))).toEqual([
      "Cliente Uno · $ 20.000",
      "Proveedor · $ 20.000",
      "Cliente Uno · $ 20.000",
    ]);
  });

  it("says a loan due on the report day falls today", () => {
    const [chip] = dailyReportPendingItems(
      dailyReportSlices({ loans: [loan({ dueAt: "2026-03-15" })] }),
    )[0].chips;

    expect(chip).toMatchObject({ value: "vence hoy", severity: "warning" });
  });

  it("collapses a day without pending work into no groups at all", () => {
    expect(dailyReportPendingItems(dailyReportSlices())).toEqual([]);
  });
});

describe("report period presets", () => {
  it("always resolves every preset to an explicit Bogotá date range", () => {
    expect(reportPeriodPresets("2026-03-15")).toEqual([
      { id: "today", label: "Hoy", startDate: "2026-03-15", endDate: "2026-03-15" },
      { id: "last7", label: "7 días", startDate: "2026-03-09", endDate: "2026-03-15" },
      { id: "thisMonth", label: "Este mes", startDate: "2026-03-01", endDate: "2026-03-15" },
      { id: "last30", label: "Últimos 30 días", startDate: "2026-02-14", endDate: "2026-03-15" },
    ]);
  });

  it("marks the preset that matches the active range and nothing else", () => {
    const presets = reportPeriodPresets("2026-03-15");

    expect(activeReportPeriodPresetId(presets, "2026-03-01", "2026-03-15")).toBe("thisMonth");
    expect(activeReportPeriodPresetId(presets, "2026-03-15", "2026-03-15")).toBe("today");
    expect(activeReportPeriodPresetId(presets, "2026-02-01", "2026-02-28")).toBeNull();
  });

  it("keeps a custom range valid instead of letting it go empty or inverted", () => {
    expect(normalizeReportPeriod("2026-03-10", "2026-03-01")).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-10",
    });
    expect(normalizeReportPeriod("2026-03-10", "")).toEqual({
      startDate: "2026-03-10",
      endDate: "2026-03-10",
    });
    expect(normalizeReportPeriod("", "")).toBeNull();
  });
});

describe("sales mix presentation", () => {
  it("groups everything past the fifth category into a single Otras slice", () => {
    const shares = categoryShares([
      { category: "Repuestos", total: 400, quantity: 4 },
      { category: "Accesorios", total: 300, quantity: 3 },
      { category: "Cascos", total: 100, quantity: 1 },
      { category: "Aceites", total: 90, quantity: 2 },
      { category: "Llantas", total: 60, quantity: 1 },
      { category: "Baterías", total: 30, quantity: 1 },
      { category: "Varios", total: 20, quantity: 1 },
    ]);

    expect(shares.map((slice) => slice.label)).toEqual([
      "Repuestos",
      "Accesorios",
      "Cascos",
      "Aceites",
      "Llantas",
      "Otras",
    ]);
    expect(shares[0].percentage).toBe(40);
    expect(shares[5]).toMatchObject({ total: 50, quantity: 2 });
    expect(shares.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 6);
  });

  it("does not invent an Otras slice when every category fits", () => {
    const shares = categoryShares([
      { category: "Cascos", total: 75, quantity: 3 },
      { category: "Repuestos", total: 25, quantity: 2 },
    ]);

    expect(shares.map((slice) => slice.label)).toEqual(["Cascos", "Repuestos"]);
    expect(shares.map((slice) => slice.percentage)).toEqual([75, 25]);
  });

  it("drops payment methods that collected nothing", () => {
    expect(
      visiblePaymentMethods([
        { paymentMethod: "CASH", total: 0, count: 0 },
        { paymentMethod: "CARD", total: 120000, count: 3 },
        { paymentMethod: "TRANSFER", total: "0.00", count: 0 },
      ]).map((method) => method.paymentMethod),
    ).toEqual(["CARD"]);
  });

  it("collapses a customer ranking of one row into a single line", () => {
    const row = { customerId: "c-1", customerName: "Cliente Uno", totalSales: 2, totalRevenue: 50000 };

    expect(customerRanking([]).mode).toBe("empty");
    expect(customerRanking([row])).toEqual({ mode: "single", rows: [row] });
    expect(
      customerRanking(
        [row, { ...row, customerId: "c-2" }, { ...row, customerId: "c-3" }, { ...row, customerId: "c-4" }, { ...row, customerId: "c-5" }, { ...row, customerId: "c-6" }],
      ),
    ).toMatchObject({ mode: "table" });
    expect(customerRanking(Array.from({ length: 6 }, (_, index) => ({ ...row, customerId: `c-${index}` }))).rows).toHaveLength(5);
  });
});

describe("profit by product", () => {
  const product = (name: string, grossProfit: string): FinancialProductMargin => ({
    productId: name,
    productName: name,
    categoryName: "Repuestos",
    quantity: 2,
    netRevenue: "100.00",
    cogs: "50.00",
    grossProfit,
    marginPercentage: 50,
  });

  it("keeps the five products that earned the most, biggest first", () => {
    const rows = topProductsByGrossProfit([
      product("A", "10.00"),
      product("B", "90.00"),
      product("C", "-5.00"),
      product("D", "40.00"),
      product("E", "60.00"),
      product("F", "20.00"),
    ]);

    expect(rows.map((row) => row.productName)).toEqual(["B", "E", "D", "F", "A"]);
  });
});
