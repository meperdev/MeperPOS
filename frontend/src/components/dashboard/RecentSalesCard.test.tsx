import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { RecentSalesCard } from "./RecentSalesCard";
import { formatDateTime } from "@/lib/utils";
import type { Customer, Payment, Sale } from "@/types";

const useSalesMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/hooks/useSales", () => ({
  useSales: (params: unknown) => useSalesMock(params),
}));

function payment(id: string, method: Payment["method"], amount: number): Payment {
  return {
    id,
    saleId: "sale-1",
    method,
    amount,
    createdAt: "2026-01-01T12:00:00.000Z",
  };
}

function customer(id: string, name: string): Customer {
  return {
    id,
    name,
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

function sale(index: number, overrides: Partial<Sale> = {}): Sale {
  return {
    id: `sale-${index}`,
    saleNumber: 100 + index,
    customerId: `customer-${index}`,
    customer: customer(`customer-${index}`, `Cliente ${index}`),
    subtotal: 100000,
    taxAmount: 19000,
    discountAmount: 0,
    total: 119000,
    amountPaid: 119000,
    change: 0,
    status: "COMPLETED",
    userId: "user-1",
    items: [],
    payments: [payment(`p-${index}`, "CASH", 119000)],
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("RecentSalesCard (compact recent sales)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSalesMock.mockReturnValue({ data: { data: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  it("requests the latest five sales", () => {
    render(<RecentSalesCard />);

    expect(useSalesMock).toHaveBeenCalledWith({ limit: 5 });
  });

  it("renders at most five rows even when the response carries more", () => {
    useSalesMock.mockReturnValue({
      data: { data: [1, 2, 3, 4, 5, 6].map((index) => sale(index)) },
    });

    render(<RecentSalesCard />);

    expect(screen.getAllByTestId("recent-sale-row")).toHaveLength(5);
    expect(screen.getAllByTestId("recent-sale-item")).toHaveLength(5);
  });

  it("renders the same sale data as a stacked list for narrow cards, one fact per line", () => {
    useSalesMock.mockReturnValue({ data: { data: [sale(1)] } });

    render(<RecentSalesCard />);

    const item = screen.getByTestId("recent-sale-item");
    expect(within(item).getByText("101")).toBeTruthy();
    expect(within(item).getByText("Cliente 1")).toBeTruthy();

    // No labelled Fecha/Pago/Total columns left to collide in on a phone.
    expect(within(item).queryByText("Fecha")).toBeNull();
    expect(within(item).queryByText("Pago")).toBeNull();
    expect(within(item).queryByText("Total")).toBeNull();
    expect(item.querySelector(".grid-cols-3")).toBeNull();

    const date = within(item).getByText(formatDateTime(sale(1).createdAt));
    expect(date.className).toContain("text-[13px]");
    expect(date.className).toContain("text-muted-foreground");
    expect(date.className).not.toContain("tabular-nums");

    const payment = within(item).getByText("Efectivo");
    const total = within(item).getByText(/\$\s119\.000/);
    expect(total.className).toContain("text-base");
    expect(total.className).toContain("tabular-nums");
    expect(total.className).toContain("font-semibold");

    // The date owns its line; payment and total share a separate baseline row.
    expect(date.contains(payment)).toBe(false);
    expect(payment.contains(date)).toBe(false);
    expect(payment.parentElement?.contains(date)).toBe(false);
    expect(total.parentElement?.contains(date)).toBe(false);
    expect(within(item).getByText("Completada")).toBeTruthy();
  });

  it("renders the minimum columns with real sale data", () => {
    useSalesMock.mockReturnValue({ data: { data: [sale(1)] } });

    render(<RecentSalesCard />);

    const row = within(screen.getByTestId("recent-sale-row"));
    expect(row.getByText("101")).toBeTruthy();
    expect(row.getByText("Cliente 1")).toBeTruthy();
    expect(row.getByText("Efectivo")).toBeTruthy();
    expect(row.getByText(/\$\s119\.000/)).toBeTruthy();
    expect(row.getByText("Completada")).toBeTruthy();
  });

  it("falls back to 'Sin cliente' when the sale has no customer", () => {
    useSalesMock.mockReturnValue({
      data: { data: [sale(1, { customer: undefined, customerId: null })] },
    });

    render(<RecentSalesCard />);

    expect(within(screen.getByRole("table")).getByText("Sin cliente")).toBeTruthy();
  });

  it("derives the payment label: none, single and mixed", () => {
    useSalesMock.mockReturnValue({
      data: {
        data: [
          sale(1, { payments: [] }),
          sale(2, { payments: [payment("p-2", "CARD", 119000)] }),
          sale(3, {
            payments: [
              payment("p-3a", "CASH", 60000),
              payment("p-3b", "TRANSFER", 59000),
            ],
          }),
        ],
      },
    });

    render(<RecentSalesCard />);

    const rows = screen.getAllByTestId("recent-sale-row");
    expect(within(rows[0]).getByText("Sin pago")).toBeTruthy();
    expect(within(rows[1]).getByText("Tarjeta")).toBeTruthy();
    expect(within(rows[2]).getByText("Mixto")).toBeTruthy();
  });

  it("maps statuses to the same badges as the sales page", () => {
    useSalesMock.mockReturnValue({
      data: {
        data: [
          sale(1, { status: "COMPLETED" }),
          sale(2, { status: "CANCELLED" }),
          sale(3, { status: "RETURNED_PARTIAL" }),
          sale(4, { status: "OPEN" }),
        ],
      },
    });

    render(<RecentSalesCard />);

    const rows = screen.getAllByTestId("recent-sale-row");
    expect(within(rows[0]).getByText("Completada")).toBeTruthy();
    expect(within(rows[1]).getByText("Cancelada")).toBeTruthy();
    expect(within(rows[2]).getByText("Parcial")).toBeTruthy();
    expect(within(rows[3]).getByText("OPEN")).toBeTruthy();
  });

  it("shows an empty state when there are no sales", () => {
    render(<RecentSalesCard />);

    expect(screen.getByText("Sin ventas recientes")).toBeTruthy();
    expect(screen.queryAllByTestId("recent-sale-row")).toHaveLength(0);
  });

  it("never scrolls internally", () => {
    useSalesMock.mockReturnValue({
      data: { data: [1, 2, 3, 4, 5, 6].map((index) => sale(index)) },
    });

    const { container } = render(<RecentSalesCard />);

    expect(container.querySelector(".overflow-y-auto")).toBeNull();
  });

  it("runs the table edge to edge like the sales page table, not inset in the card padding", () => {
    useSalesMock.mockReturnValue({ data: { data: [sale(1)] } });

    render(<RecentSalesCard />);

    const card = screen.getByTestId("recent-sales-card");
    expect(card.className).toContain("overflow-hidden");
    expect(card.className).not.toMatch(/(^|\s)p-4(\s|$)/);
    const table = within(card).getByRole("table");
    let node: HTMLElement | null = table.parentElement;
    while (node && node !== card) {
      expect(node.className).not.toMatch(/(^|\s)(p|px|mt)-\S+/);
      node = node.parentElement;
    }
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header.className).not.toContain("px-2");
    }
  });

  it("sets money in the tabular sans, not the mono face, in both layouts", () => {
    useSalesMock.mockReturnValue({ data: { data: [sale(1)] } });

    render(<RecentSalesCard />);

    const rowTotal = within(screen.getByTestId("recent-sale-row")).getByText(/\$\s119\.000/);
    const stackedTotal = within(screen.getByTestId("recent-sale-item")).getByText(/\$\s119\.000/);
    for (const total of [rowTotal, stackedTotal]) {
      expect(total).not.toHaveClass("font-mono");
      expect(total).toHaveClass("tabular-nums");
    }
  });

  it("links 'Ver todas' to the sales page", () => {
    render(<RecentSalesCard />);

    const link = screen.getByRole("link", { name: /ver todas/i });
    expect(link).toHaveAttribute("href", "/sales");
  });
});
