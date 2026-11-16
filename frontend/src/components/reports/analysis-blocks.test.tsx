import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type {
  AppliedRange,
  CashFlowReport,
  CustomerStatistics,
  InventorySnapshotReport,
  UserPerformanceReport,
} from "@/types";
import { CashPaymentsBlock } from "./CashPaymentsBlock";
import { CategoriesBlock } from "./CategoriesBlock";
import { CustomersBlock } from "./CustomersBlock";
import { InventoryBlock } from "./InventoryBlock";
import { SellerPerformanceBlock } from "./SellerPerformanceBlock";
import { ProductProfitBlock } from "./ProductProfitBlock";
import { TopProductsBlock } from "./TopProductsBlock";

const range: AppliedRange = {
  startDate: "2026-03-01",
  endDate: "2026-03-15",
  timezone: "America/Bogota",
};

const idle = { isLoading: false, error: null, refetch: () => undefined };

const envelope = <T,>(data: T) => ({ data: { data, appliedRange: range }, ...idle });

const cash = (overrides: Partial<CashFlowReport> = {}): CashFlowReport => ({
  accountingBasis: "PAYMENTS",
  netFlow: "70000.00",
  collections: { total: "130000.00", byPaymentMethod: [] },
  expensePayments: { total: "60000.00", byPaymentMethod: [] },
  appliedRange: range,
  ...overrides,
});

afterEach(cleanup);

describe("Caja y pagos", () => {
  it("merges cash and payment methods into one section with two halves", () => {
    render(
      <CashPaymentsBlock
        cash={{ data: cash(), ...idle }}
        payments={envelope([
          { paymentMethod: "CASH", total: 120000, subtotal: 100000, count: 3 },
        ])}
      />,
    );

    // One card, one heading: the two halves are not sections of their own.
    expect(screen.getAllByRole("heading", { name: "Caja y pagos" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Métodos de pago" })).toBeNull();

    const section = screen.getByRole("heading", { name: "Caja y pagos" }).closest("section")!;
    expect(within(section).getByText("Plata que entró")).toBeInTheDocument();
    expect(within(section).getByText("Plata que salió")).toBeInTheDocument();
    expect(within(section).getByText("Métodos de pago")).toBeInTheDocument();
    expect(within(section).getByText("Efectivo")).toBeInTheDocument();
  });

  it("shows the net flow the server sent and never re-subtracts it", () => {
    const { unmount } = render(
      <CashPaymentsBlock
        cash={{ data: cash(), ...idle }}
        payments={envelope([])}
      />,
    );

    expect(screen.getByText("Flujo neto de caja").closest("div")).toHaveTextContent("70.000");
    unmount();

    // An older response without `netFlow` drops the row instead of guessing.
    render(
      <CashPaymentsBlock
        cash={{ data: cash({ netFlow: undefined }), ...idle }}
        payments={envelope([])}
      />,
    );
    expect(screen.queryByText("Flujo neto de caja")).toBeNull();
  });

  it("keeps each half in its own state when only one request fails", () => {
    render(
      <CashPaymentsBlock
        cash={{ data: undefined, isLoading: false, error: new Error("network"), refetch: () => undefined }}
        payments={envelope([
          { paymentMethod: "CARD", total: 120000, subtotal: 100000, count: 3 },
        ])}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Tarjeta")).toBeInTheDocument();
    expect(screen.getByText("3 pagos")).toBeInTheDocument();
  });

  it("hides the payment methods that collected nothing", () => {
    render(
      <CashPaymentsBlock
        cash={{ data: cash(), ...idle }}
        payments={envelope([
          { paymentMethod: "CASH", total: 0, subtotal: 0, count: 0 },
          { paymentMethod: "CARD", total: 120000, subtotal: 100000, count: 3 },
        ])}
      />,
    );

    expect(screen.getByText("Tarjeta")).toBeInTheDocument();
    expect(screen.queryByText("Efectivo")).toBeNull();
  });

  it("collapses a period without payments into one line inside the same card", () => {
    render(
      <CashPaymentsBlock
        cash={{ data: cash(), ...idle }}
        payments={envelope([{ paymentMethod: "CASH", total: 0, subtotal: 0, count: 0 }])}
      />,
    );

    expect(screen.getByText("Sin pagos registrados en el período.")).toBeInTheDocument();
  });
});

describe("Productos más vendidos", () => {
  it("keeps the ranked list and the empty line it had before the layout change", () => {
    render(
      <TopProductsBlock
        query={envelope([
          { productId: "p-1", productName: "Casco", quantity: 4, total: 100000, stock: 8 },
        ])}
      />,
    );

    expect(screen.getByText("Casco")).toBeInTheDocument();
    expect(screen.getByText("4 vendidos")).toBeInTheDocument();
    cleanup();

    render(<TopProductsBlock query={envelope([])} />);
    expect(screen.getByText("Sin productos vendidos en el período.")).toBeInTheDocument();
  });
});

describe("Inventario actual", () => {
  const inventory = (): InventorySnapshotReport => ({
    isCurrentSnapshot: true,
    valuationBasis: "CURRENT_STOCK_AT_CURRENT_COST",
    current: {
      stockQuantity: 1155,
      stockValue: "4520400.00",
      retailValue: "7379800.00",
      potentialProfit: "2859400.00",
    },
    movements: { totalQuantity: 0, byType: {} },
    appliedRange: range,
  });

  it("puts its four figures on one strip instead of two half-width rows", () => {
    const { container } = render(<InventoryBlock query={{ data: inventory(), ...idle }} />);
    const strip = container.querySelector("[data-stat-strip='inventory']")!;

    expect(strip.children).toHaveLength(4);
    expect(strip.className).toContain("sm:grid-cols-4");
    for (const label of [
      "Lo que costó tu inventario",
      "Lo que vale si vendes todo",
      "Ganancia posible",
      "Unidades en stock",
    ]) {
      expect(within(strip as HTMLElement).getByText(label)).toBeInTheDocument();
    }
  });
});

describe("Categorías", () => {
  it("draws one 100% bar and its legend without an Otras slice while everything fits", () => {
    render(
      <CategoriesBlock
        query={envelope([
          { category: "Cascos", total: 75, quantity: 3 },
          { category: "Repuestos", total: 25, quantity: 2 },
        ])}
      />,
    );

    expect(
      screen.getByRole("img", { name: /Mezcla de ventas por categoría/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cascos")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.queryByText("Otras")).toBeNull();
  });

  it("groups the sixth category onwards as Otras", () => {
    render(
      <CategoriesBlock
        query={envelope([
          { category: "Repuestos", total: 400, quantity: 4 },
          { category: "Accesorios", total: 300, quantity: 3 },
          { category: "Cascos", total: 100, quantity: 1 },
          { category: "Aceites", total: 90, quantity: 2 },
          { category: "Llantas", total: 60, quantity: 1 },
          { category: "Baterías", total: 30, quantity: 1 },
          { category: "Varios", total: 20, quantity: 1 },
        ])}
      />,
    );

    expect(screen.getByText("Otras")).toBeInTheDocument();
    expect(screen.getByText("5%")).toBeInTheDocument();
    expect(screen.queryByText("Baterías")).toBeNull();
  });

  it("sets the legend in two columns on wide screens", () => {
    const { container } = render(
      <CategoriesBlock
        query={envelope([
          { category: "Cascos", total: 400, quantity: 3 },
          { category: "Repuestos", total: 300, quantity: 2 },
          { category: "Aceites", total: 200, quantity: 1 },
          { category: "Llantas", total: 100, quantity: 1 },
        ])}
      />,
    );
    const legend = container.querySelector("[data-category-legend]")!;

    expect(legend.children).toHaveLength(4);
    expect(legend.className).toContain("lg:grid-cols-2");
  });

  it("collapses an empty category mix into one line", () => {
    render(<CategoriesBlock query={envelope([])} />);

    expect(screen.getByText("Sin ventas por categoría en el período.")).toBeInTheDocument();
  });
});

describe("Mejores clientes", () => {
  const customer = (index: number) => ({
    customerId: `c-${index}`,
    customerName: `Cliente ${index}`,
    totalSales: index,
    totalRevenue: 50000 * index,
  });

  it("renders one row as a sentence instead of a table card", () => {
    render(
      <CustomersBlock
        query={{
          data: { totalCustomers: 1, activeCustomers: 1, topCustomers: [customer(2)], appliedRange: range },
          ...idle,
        }}
      />,
    );

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/Cliente 2 compró 2 veces/)).toBeInTheDocument();
  });

  it("keeps the customer table to five rows", () => {
    const topCustomers = [1, 2, 3, 4, 5, 6, 7].map(customer);
    render(
      <CustomersBlock
        query={{
          data: { totalCustomers: 7, activeCustomers: 7, topCustomers, appliedRange: range },
          ...idle,
        }}
      />,
    );

    const table = within(screen.getByRole("table"));
    expect(table.getAllByText(/^Cliente \d$/)).toHaveLength(5);
    expect(table.queryByText("Cliente 7")).toBeNull();
  });

  it("says plainly when nobody bought on account", () => {
    const data: CustomerStatistics = {
      totalCustomers: 0,
      activeCustomers: 0,
      topCustomers: [],
      appliedRange: range,
    };
    render(<CustomersBlock query={{ data, ...idle }} />);

    expect(
      screen.getByText("Sin compras registradas con cliente en el período."),
    ).toBeInTheDocument();
  });
});

describe("Ventas por vendedor", () => {
  const seller = (index: number) => ({
    userId: `u-${index}`,
    userName: `Vendedor ${index}`,
    salesCount: 3,
    revenue: 180000 * index,
    avgTicket: 60000,
    uniqueCustomers: 2,
  });

  it("shows the ticket the server computed for each seller", () => {
    const data: UserPerformanceReport = { data: [seller(1)], appliedRange: range };
    render(<SellerPerformanceBlock query={{ data, ...idle }} />);

    const row = screen.getByText("Vendedor 1").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText(/60\.000/)).toBeInTheDocument();
    expect(within(row!).getByText("3")).toBeInTheDocument();
  });

  it("stops the ranking at five sellers", () => {
    const data: UserPerformanceReport = {
      data: [1, 2, 3, 4, 5, 6].map(seller),
      appliedRange: range,
    };
    render(<SellerPerformanceBlock query={{ data, ...idle }} />);

    expect(screen.getAllByText(/^Vendedor \d$/)).toHaveLength(5);
    expect(screen.getByText("1 vendedor más con ventas en el período.")).toBeInTheDocument();
  });

  it("collapses a period without sellers into one line", () => {
    render(
      <SellerPerformanceBlock query={{ data: { data: [], appliedRange: range }, ...idle }} />,
    );

    expect(screen.getByText("Sin ventas por vendedor en el período.")).toBeInTheDocument();
  });
});

describe("Ganancia por producto", () => {
  it("ranks the five products with the biggest gross profit", () => {
    render(
      <ProductProfitBlock
        products={[
          { productId: "a", productName: "Casco", categoryName: "Repuestos", quantity: 2, netRevenue: "100.00", cogs: "50.00", grossProfit: "10.00", marginPercentage: 10 },
          { productId: "b", productName: "Llanta", categoryName: "Repuestos", quantity: 1, netRevenue: "300.00", cogs: "120.00", grossProfit: "180.00", marginPercentage: 60 },
        ]}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Llanta")).toBeInTheDocument();
    expect(within(rows[0]).getByText("60.0%")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Casco")).toBeInTheDocument();
  });

  it("collapses a period without margins into one line", () => {
    render(<ProductProfitBlock products={[]} />);

    expect(screen.getByText("Sin ganancia por producto en el período.")).toBeInTheDocument();
  });
});
