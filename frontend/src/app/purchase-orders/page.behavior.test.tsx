import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const { authState, urlState, listState, routerPush, usePurchaseOrdersMock } =
  vi.hoisted(() => ({
    authState: { role: "ADMIN" },
    urlState: { params: new URLSearchParams() },
    listState: { orders: [] as unknown[] },
    routerPush: vi.fn(),
    usePurchaseOrdersMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => urlState.params,
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
  usePurchaseOrders: (params: unknown) => {
    usePurchaseOrdersMock(params);
    return {
      data: {
        data: listState.orders,
        meta: {
          total: listState.orders.length,
          page: 1,
          limit: 15,
          totalPages: 1,
        },
      },
      isLoading: false,
    };
  },
}));

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: () => ({ data: { data: [] } }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      role: authState.role,
      name: "Admin",
      email: "admin@example.com",
    },
  }),
}));

import PurchaseOrdersPage from "./page";

describe("Purchase orders list page — create action is gated by the role hierarchy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = "ADMIN";
  });

  afterEach(() => {
    cleanup();
  });

  it("shows Nueva orden for ADMIN", () => {
    authState.role = "ADMIN";

    render(<PurchaseOrdersPage />);

    expect(screen.getByRole("link", { name: /nueva orden/i }).getAttribute("href")).toBe("/purchase-orders/new");
  });

  it("shows Nueva orden for SUPER_ADMIN", () => {
    authState.role = "SUPER_ADMIN";

    render(<PurchaseOrdersPage />);

    expect(screen.getByRole("link", { name: /nueva orden/i })).toBeTruthy();
  });

  it("hides Nueva orden for CASHIER", () => {
    authState.role = "CASHIER";

    render(<PurchaseOrdersPage />);

    expect(screen.queryByRole("link", { name: /nueva orden/i })).toBeNull();
  });
});

describe("Purchase orders date filters on narrow screens", () => {
  afterEach(() => {
    cleanup();
  });

  it("puts the two date inputs in a two-column grid that cannot overflow the filter card", () => {
    render(<PurchaseOrdersPage />);
    const from = screen.getByLabelText("Fecha inicial");
    const to = screen.getByLabelText("Fecha final");
    // Input wraps its <input> in its own block, so the shared grid is the nearest ancestor.
    const wrapper = from.closest<HTMLElement>(".grid")!;

    expect(wrapper).toContainElement(to);
    expect(wrapper).toHaveClass("grid", "grid-cols-2", "gap-2");
    expect(wrapper).toHaveClass("sm:flex", "sm:w-auto");
    for (const input of [from, to]) {
      expect(input).toHaveClass("min-w-0", "w-full");
    }
  });
});

describe("Purchase orders status filter from the URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    urlState.params = new URLSearchParams();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens already filtered to the open orders when the link asks for status=OPEN", () => {
    urlState.params = new URLSearchParams("status=OPEN");

    render(<PurchaseOrdersPage />);

    expect(usePurchaseOrdersMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "OPEN", page: 1 }),
    );
    expect(screen.getByRole("button", { name: /limpiar/i })).toBeTruthy();
  });

  it("opens filtered to the overdue orders when the link asks for status=OVERDUE", () => {
    urlState.params = new URLSearchParams("status=OVERDUE");

    render(<PurchaseOrdersPage />);

    expect(usePurchaseOrdersMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "OVERDUE", page: 1 }),
    );
  });

  it("marks a sent order as sent and an overdue one as overdue", () => {
    urlState.params = new URLSearchParams();
    const base = {
      supplierId: "s-1",
      supplier: { id: "s-1", name: "Proveedor Andino" },
      createdById: "u-1",
      status: "PENDING",
      subtotal: 100,
      taxAmount: 19,
      total: 119,
      createdAt: "2026-04-19T09:00:00.000Z",
      updatedAt: "2026-04-19T09:00:00.000Z",
    };
    listState.orders = [
      { ...base, id: "po-1", orderNumber: 1, sentAt: "2026-04-19T10:00:00.000Z", overdue: true },
      { ...base, id: "po-2", orderNumber: 2, sentAt: null, overdue: false },
    ];

    render(<PurchaseOrdersPage />);
    listState.orders = [];

    expect(screen.getAllByText("Enviada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Atrasada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pendiente").length).toBeGreaterThan(0);
  });

  it("ignores an unknown status in the URL and lists every order as before", () => {
    urlState.params = new URLSearchParams("status=NOPE");

    render(<PurchaseOrdersPage />);

    expect(usePurchaseOrdersMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined }),
    );
  });
});

// S10: the list keeps its shape; only the separate "Detalle" control goes away,
// because the card and the row already open the order.
describe("Purchase orders list — the order itself opens the detail", () => {
  const VIEW_MODE_KEY = "meperpos:view-mode:purchase-orders";

  const order = {
    id: "po-1",
    orderNumber: 1,
    supplierId: "s-1",
    supplier: { id: "s-1", name: "Proveedor Andino" },
    createdById: "u-1",
    status: "PENDING",
    subtotal: 100,
    taxAmount: 19,
    total: 119,
    notes: null,
    sentAt: null,
    overdue: false,
    createdAt: "2026-04-19T09:00:00.000Z",
    updatedAt: "2026-04-19T09:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listState.orders = [order];
  });

  afterEach(() => {
    listState.orders = [];
    window.localStorage.removeItem(VIEW_MODE_KEY);
    cleanup();
  });

  it("drops the Detalle button from the card and opens the order by click and Enter", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(VIEW_MODE_KEY, "grid");

    render(<PurchaseOrdersPage />);

    expect(screen.queryByRole("button", { name: /^detalle$/i })).toBeNull();

    const card = screen.getByRole("button", { name: "Ver orden OC-1" });
    expect(card).toHaveAttribute("tabindex", "0");

    await user.click(card);
    expect(routerPush).toHaveBeenCalledWith("/purchase-orders/po-1");

    card.focus();
    await user.keyboard("{Enter}");
    expect(routerPush).toHaveBeenCalledTimes(2);
  });

  it("drops the eye column from the table row; the row opens the order", () => {
    window.localStorage.setItem(VIEW_MODE_KEY, "table");

    render(<PurchaseOrdersPage />);

    expect(screen.queryByRole("button", { name: /^detalle$/i })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();

    const row = screen.getByRole("button", { name: "Ver orden OC-1" });
    expect(row.tagName).toBe("TR");
    expect(row).toHaveAttribute("tabindex", "0");
  });
});
