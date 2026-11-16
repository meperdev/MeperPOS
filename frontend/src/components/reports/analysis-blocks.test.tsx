import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AppliedRange, CustomerStatistics, UserPerformanceReport } from "@/types";
import { CategoriesBlock } from "./CategoriesBlock";
import { PaymentMethodsBlock } from "./PaymentMethodsBlock";
import { CustomersBlock } from "./CustomersBlock";
import { SellerPerformanceBlock } from "./SellerPerformanceBlock";
import { ProductProfitBlock } from "./ProductProfitBlock";

const range: AppliedRange = {
  startDate: "2026-03-01",
  endDate: "2026-03-15",
  timezone: "America/Bogota",
};

const idle = { isLoading: false, error: null, refetch: () => undefined };

const envelope = <T,>(data: T) => ({ data: { data, appliedRange: range }, ...idle });

afterEach(cleanup);

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

  it("collapses an empty category mix into one line", () => {
    render(<CategoriesBlock query={envelope([])} />);

    expect(screen.getByText("Sin ventas por categoría en el período.")).toBeInTheDocument();
  });
});

describe("Métodos de pago", () => {
  it("hides the methods that collected nothing", () => {
    render(
      <PaymentMethodsBlock
        query={envelope([
          { paymentMethod: "CASH", total: 0, subtotal: 0, count: 0 },
          { paymentMethod: "CARD", total: 120000, subtotal: 100000, count: 3 },
        ])}
      />,
    );

    expect(screen.getByText("Tarjeta")).toBeInTheDocument();
    expect(screen.queryByText("Efectivo")).toBeNull();
    expect(screen.getByText("3 pagos")).toBeInTheDocument();
  });

  it("collapses a period without payments into one line", () => {
    render(
      <PaymentMethodsBlock
        query={envelope([{ paymentMethod: "CASH", total: 0, subtotal: 0, count: 0 }])}
      />,
    );

    expect(screen.getByText("Sin pagos registrados en el período.")).toBeInTheDocument();
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
