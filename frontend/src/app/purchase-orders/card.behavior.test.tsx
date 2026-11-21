import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

const { listState, routerPush } = vi.hoisted(() => ({
  listState: { orders: [] as unknown[] },
  routerPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/Select", () => ({
  Select: ({ placeholder }: { placeholder?: string }) => (
    <select aria-label={placeholder ?? "select"} />
  ),
}));

vi.mock("@/hooks/usePurchaseOrders", () => ({
  usePurchaseOrders: () => ({
    data: {
      data: listState.orders,
      meta: { total: listState.orders.length, page: 1, limit: 15, totalPages: 1 },
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: () => ({ data: { data: [] } }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      role: "ADMIN",
      name: "Admin",
      email: "admin@example.com",
    },
  }),
}));

import {
  formatCalendarDay,
  formatCalendarDayShort,
  formatCurrency,
  formatDate,
  formatDateShort,
} from "@/lib/utils";
import PurchaseOrdersPage from "./page";

const VIEW_MODE_KEY = "meperpos:view-mode:purchase-orders";

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    purchaseOrderId: "po-1",
    productId: "product-1",
    qtyOrdered: 6,
    qtyReceived: 2,
    unitCost: 1000,
    taxRate: 0,
    subtotal: 6000,
    taxAmount: 0,
    ...overrides,
  };
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "po-1",
    orderNumber: 42,
    supplierId: "s-1",
    supplier: { id: "s-1", name: "Distribuidora Andina" },
    createdById: "u-1",
    status: "PARTIAL_RECEIVED",
    subtotal: 200_000,
    taxAmount: 0,
    total: 200_000,
    notes: null,
    sentAt: null,
    expectedDeliveryDate: null,
    overdue: false,
    createdAt: "2026-04-19T09:00:00.000Z",
    updatedAt: "2026-04-19T09:00:00.000Z",
    items: [
      makeItem({ id: "item-1", qtyOrdered: 6, qtyReceived: 2 }),
      makeItem({ id: "item-2", qtyOrdered: 4, qtyReceived: 1 }),
    ],
    ...overrides,
  };
}

/** Renders the list in card view and scopes the queries to the one card. */
function renderCard(order = makeOrder()) {
  listState.orders = [order];
  render(<PurchaseOrdersPage />);
  const element = screen.getByRole("button", {
    name: `Ver orden OC-${order.orderNumber}`,
  });
  return { element, card: within(element) };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem(VIEW_MODE_KEY, "grid");
});

afterEach(() => {
  listState.orders = [];
  window.localStorage.removeItem(VIEW_MODE_KEY);
  cleanup();
});

describe("Purchase order card — header", () => {
  it("reads the supplier first, the order number underneath and the status on the right", () => {
    const { element, card } = renderCard();

    const supplier = card.getByText("Distribuidora Andina");
    expect(supplier).toHaveClass("truncate", "text-sm", "font-semibold");

    const number = card.getByText("OC-42");
    expect(number).toHaveClass("id-text", "text-[13px]", "text-muted-foreground");

    // 32px icon tile, as in the loan card.
    const tile = element.querySelector("svg")?.parentElement;
    expect(tile).toHaveClass("h-8", "w-8", "rounded-lg", "border");

    expect(card.getByText("Recibida parcial")).toBeTruthy();
  });
});

describe("Purchase order card — reception progress", () => {
  it("reads how much of the order arrived from the quantities in the payload", () => {
    const { card } = renderCard();

    // 3 of 10 units received: the percentage is display-only.
    const progress = card.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("30");
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");

    expect(card.getByText("Recibido 30%")).toBeTruthy();
    expect(card.getByText("3 de 10 und.")).toBeTruthy();

    const fill = card.getByTestId("po-progress-fill");
    expect(fill.className).toContain("bg-primary");
    expect(fill.style.width).toBe("30%");
  });

  it("replaces the bar with the settled strip once every unit was received", () => {
    const { card } = renderCard(
      makeOrder({
        status: "RECEIVED",
        receivedAt: "2026-04-22T15:30:00.000Z",
        items: [
          makeItem({ id: "item-1", qtyOrdered: 6, qtyReceived: 6 }),
          makeItem({ id: "item-2", qtyOrdered: 4, qtyReceived: 4 }),
        ],
      }),
    );

    expect(card.queryByRole("progressbar")).toBeNull();

    const strip = card.getByTestId("po-settled-line");
    expect(strip).toHaveClass("h-7", "w-full", "bg-muted/40");
    expect(within(strip).getByText("Recibida completa")).toBeInTheDocument();
    // `receivedAt` is an instant, so the strip reads the compact day.
    expect(
      within(strip).getByText(formatDateShort("2026-04-22T15:30:00.000Z")),
    ).toHaveClass("ml-auto", "text-muted-foreground");
  });

  it("settles on the quantities when the status has not caught up", () => {
    const { card } = renderCard(
      makeOrder({
        status: "PARTIAL_RECEIVED",
        items: [
          makeItem({ id: "item-1", qtyOrdered: 6, qtyReceived: 6 }),
          makeItem({ id: "item-2", qtyOrdered: 4, qtyReceived: 4 }),
        ],
      }),
    );

    expect(card.queryByRole("progressbar")).toBeNull();
    // No received day in the payload: the strip states the verdict alone.
    expect(card.getByTestId("po-settled-line").textContent).toBe(
      "Recibida completa",
    );
  });

  it("keeps a draft at zero in the muted tone", () => {
    const { card } = renderCard(
      makeOrder({
        status: "DRAFT",
        items: [
          makeItem({ id: "item-1", qtyOrdered: 6, qtyReceived: 3 }),
          makeItem({ id: "item-2", qtyOrdered: 4, qtyReceived: 2 }),
        ],
      }),
    );

    expect(card.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(card.getByTestId("po-progress-fill").className).toContain(
      "bg-muted-foreground/30",
    );
    expect(card.getByText("Recibido 0%")).toBeTruthy();
  });

  it("drops the bar when the payload carries no quantities to read", () => {
    const { card } = renderCard(makeOrder({ items: undefined }));

    expect(card.queryByRole("progressbar")).toBeNull();
  });
});

describe("Purchase order card — amounts", () => {
  it("states the total, the line count and the ordered units in three divided cells", () => {
    const { card } = renderCard();

    expect(card.getByText("Total compra")).toBeTruthy();
    // The money cell reads the server's total; the query compares textContent
    // because `formatCurrency` joins symbol and amount with a no-break space.
    expect(card.getByText("Total compra").nextElementSibling?.textContent).toBe(
      formatCurrency(200_000),
    );
    expect(card.getByText("Productos")).toBeTruthy();
    expect(card.getByText("2")).toBeTruthy();
    expect(card.getByText("Unidades")).toBeTruthy();
    expect(card.getByText("10")).toBeTruthy();

    const row = card.getByText("Total compra").closest("div")?.parentElement;
    expect(row).toHaveClass("grid", "grid-cols-3", "divide-x", "divide-border/60");
  });

  it("falls back to two cells when there are no units to count", () => {
    const { card } = renderCard(
      makeOrder({ items: [makeItem({ qtyOrdered: 0, qtyReceived: 0 })] }),
    );

    expect(card.getByText("Productos")).toBeTruthy();
    expect(card.queryByText("Unidades")).toBeNull();

    const row = card.getByText("Total compra").closest("div")?.parentElement;
    expect(row).toHaveClass("grid", "grid-cols-2");
  });

  it("still states the total when the payload carries no items at all", () => {
    const { card } = renderCard(makeOrder({ items: undefined }));

    expect(card.getByText("Total compra")).toBeTruthy();
    expect(card.queryByText("Productos")).toBeNull();
    expect(card.queryByText("Unidades")).toBeNull();

    const row = card.getByText("Total compra").closest("div")?.parentElement;
    expect(row).toHaveClass("grid", "grid-cols-1");
  });
});

describe("Purchase order card — footer", () => {
  it("states the creation day and the expected delivery, overdue in the danger tone", () => {
    const { card } = renderCard(
      makeOrder({
        status: "PENDING",
        sentAt: "2026-03-30T12:00:00.000Z",
        expectedDeliveryDate: "2026-04-01T00:00:00.000Z",
        overdue: true,
      }),
    );

    expect(card.getByText("Creada")).toBeTruthy();
    // A narrow footer cell reads the compact day, never the prose wording; the
    // prose stays reachable through the `title`.
    const created = card.getByText(formatDateShort("2026-04-19T09:00:00.000Z"));
    expect(created).toHaveAttribute(
      "title",
      formatDate("2026-04-19T09:00:00.000Z"),
    );
    expect(card.queryByText(formatDate("2026-04-19T09:00:00.000Z"))).toBeNull();

    // A calendar day (`@db.Date`) reads as that same day.
    expect(card.getByText("Entrega")).toBeTruthy();
    const delivery = card.getByText(
      formatCalendarDayShort("2026-04-01T00:00:00.000Z"),
    );
    expect(delivery).toHaveClass("text-danger-text");
    expect(delivery).toHaveAttribute(
      "title",
      formatCalendarDay("2026-04-01T00:00:00.000Z"),
    );

    expect(card.getByText("Vencida")).toHaveClass("text-danger-text");
  });

  it("reads the send date when the order carries no expected delivery", () => {
    const { card } = renderCard(
      makeOrder({
        status: "PENDING",
        sentAt: "2026-03-30T12:00:00.000Z",
      }),
    );

    expect(card.getByText("Enviada", { selector: "dt" })).toBeTruthy();
    // `sentAt` is an instant: the cell reads the compact day, the prose wording
    // stays in the `title`.
    const sent = card.getByText(formatDateShort("2026-03-30T12:00:00.000Z"));
    expect(sent).toHaveAttribute("title", formatDate("2026-03-30T12:00:00.000Z"));
  });

  it("keeps the note on one line with its full text reachable", () => {
    const note = "Entregar en bodega antes del mediodía";
    const { card } = renderCard(makeOrder({ notes: note }));

    const line = card.getByText(note);
    expect(line).toHaveClass("truncate");
    expect(line).toHaveAttribute("title", note);
  });

  it("omits the note line when the order has no note", () => {
    const { card } = renderCard(makeOrder({ notes: null }));

    expect(card.getByText("Creada")).toBeTruthy();
    expect(card.queryByText(/^Nota/)).toBeNull();
  });
});
