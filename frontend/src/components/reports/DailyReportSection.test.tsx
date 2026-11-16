import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { DailyReport } from "@/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { DailyReportSection } from "./DailyReportSection";

const report: DailyReport = {
  cutoff: "2026-03-15T18:42:00.000Z",
  date: "2026-03-15",
  timezone: "America/Bogota",
  salesTotal: "120000.00",
  expenseTotal: "30000.00",
  sales: [
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
  ],
  expenses: [],
  lowStock: [0, 1, 2, 3, 4, 5, 6].map((index) => ({
    id: `low-${index}`,
    name: `Producto ${index}`,
    sku: `SKU-${index}`,
    type: "PRODUCT",
    tracksStock: true,
    stock: index,
    minStock: 10,
  })),
  purchaseOrders: [
    {
      id: "po-1",
      orderNumber: 12,
      status: "PENDING",
      total: "90000.00",
      supplier: { name: "Proveedor Uno" },
    },
  ],
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
};

function renderSection(overrides: Partial<Parameters<typeof DailyReportSection>[0]> = {}) {
  return render(
    <DailyReportSection
      report={report}
      isLoading={false}
      error={null}
      onRetry={vi.fn()}
      onRefresh={vi.fn()}
      {...overrides}
    />,
  );
}

/** Groups of the pending grid, found by their heading rail. */
function pendingCard(label: string) {
  return screen.getByText(label).closest("[data-pending-group]") as HTMLElement;
}

afterEach(cleanup);

describe("Hoy (daily report)", () => {
  it("shows today's pulse, the cutoff time and only the pending groups with work", () => {
    renderSection();

    expect(screen.getByRole("heading", { name: "Hoy" })).toBeInTheDocument();
    expect(screen.getByText("15 de marzo")).toBeInTheDocument();
    expect(screen.getByText("13:42")).toBeInTheDocument();

    // Money comes from the payload, formatted, never re-added in the browser.
    expect(screen.getByText(/120\.000/)).toBeInTheDocument();
    expect(screen.getByText(/30\.000/)).toBeInTheDocument();
    expect(screen.getByText("Ventas registradas").closest("div")).toHaveTextContent("2");

    const lowStockCard = pendingCard("Productos con stock bajo");
    expect(within(lowStockCard).getByText("7")).toBeInTheDocument();
    expect(within(lowStockCard).getByRole("link", { name: /Ver/ })).toHaveAttribute(
      "href",
      "/inventory?filter=lowStock",
    );
    expect(within(lowStockCard).getByText("+4 más")).toBeInTheDocument();

    expect(pendingCard("Préstamos vencidos o por vencer")).toBeInTheDocument();
    expect(pendingCard("Órdenes de compra pendientes")).toBeInTheDocument();
  });

  it("lays the pending groups on one equal-height grid sized to how many have work", () => {
    const { container } = renderSection();
    const grid = container.querySelector("[data-pending-grid]")!;

    expect(grid).toHaveAttribute("data-pending-count", "3");
    expect(grid.className).toContain("md:grid-cols-3");
    for (const card of container.querySelectorAll("[data-pending-group]")) {
      expect(card.className).toContain("h-full");
    }

    cleanup();
    const two = renderSection({
      report: { ...report, purchaseOrders: [] },
    }).container;
    const twoGrid = two.querySelector("[data-pending-grid]")!;
    expect(twoGrid).toHaveAttribute("data-pending-count", "2");
    expect(twoGrid.className).toContain("md:grid-cols-2");
    expect(twoGrid.className).not.toContain("md:grid-cols-3");
  });

  it("renders each pending item as a chip with its key value and a status dot", () => {
    renderSection();

    const lowStockCard = pendingCard("Productos con stock bajo");
    const chips = lowStockCard.querySelectorAll("[data-pending-chip]");
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent("Producto 0");
    expect(chips[0]).toHaveTextContent("0 / mín 10");
    expect(chips[0].querySelector("[data-severity]")).toHaveAttribute(
      "data-severity",
      "danger",
    );
    expect(chips[1].querySelector("[data-severity]")).toHaveAttribute(
      "data-severity",
      "warning",
    );

    const orders = pendingCard("Órdenes de compra pendientes");
    expect(within(orders).getByText("#12 · Proveedor Uno")).toBeInTheDocument();
    expect(within(orders).getByText("Pendiente")).toBeInTheDocument();
    expect(
      orders.querySelector("[data-severity]"),
    ).toHaveAttribute("data-severity", "warning");

    const loans = pendingCard("Préstamos vencidos o por vencer");
    expect(within(loans).getByText("venció 10 mar")).toBeInTheDocument();
    expect(loans.querySelector("[data-severity]")).toHaveAttribute(
      "data-severity",
      "danger",
    );
  });

  it("collapses the pending block to one line when the day has no pending work", () => {
    renderSection({
      report: { ...report, lowStock: [], loans: [], purchaseOrders: [] },
    });

    expect(
      screen.getByText("Sin pendientes para hoy: stock, órdenes de compra y préstamos al día."),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-pending-grid]")).toBeNull();
  });

  it("reveals today's sales with number, time, customer and total", () => {
    renderSection();

    const toggle = screen.getByRole("button", { name: /Ver ventas/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("#41")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = within(screen.getByRole("list", { name: "Ventas de hoy" }));
    expect(list.getByText("#41")).toBeInTheDocument();
    expect(list.getByText("13:42")).toBeInTheDocument();
    expect(list.getByText("Cliente Uno")).toBeInTheDocument();
    expect(list.getByText("Sin cliente")).toBeInTheDocument();

    // Newest sale first.
    const numbers = list.getAllByText(/^#4\d$/).map((node) => node.textContent);
    expect(numbers).toEqual(["#41", "#40"]);
  });

  it("collapses a day without sales into one line", () => {
    renderSection({ report: { ...report, sales: [] } });

    fireEvent.click(screen.getByRole("button", { name: /Ver ventas/ }));

    expect(screen.getByText("Sin ventas registradas hoy.")).toBeInTheDocument();
  });

  it("paints the loading shape and announces the failure with a retry", () => {
    const onRetry = vi.fn();
    renderSection({ report: undefined, isLoading: true });

    expect(screen.getByText("Cargando reporte del día…")).toBeInTheDocument();
    expect(document.querySelector("[aria-busy='true']")).toBeTruthy();

    cleanup();
    renderSection({ report: undefined, error: new Error("network"), onRetry });

    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("offers a manual refresh without touching the period filter", () => {
    const onRefresh = vi.fn();
    renderSection({ onRefresh });

    fireEvent.click(screen.getByRole("button", { name: /Actualizar/ }));

    expect(onRefresh).toHaveBeenCalled();
  });
});
