import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const { authState } = vi.hoisted(() => ({ authState: { role: "ADMIN" } }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
      data: [],
      meta: { total: 0, page: 1, limit: 15, totalPages: 1 },
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

  it("shows Nueva orden for OWNER", () => {
    authState.role = "OWNER";

    render(<PurchaseOrdersPage />);

    expect(screen.getByRole("link", { name: /nueva orden/i }).getAttribute("href")).toBe("/purchase-orders/new");
  });

  it("shows Nueva orden for SUPER_ADMIN", () => {
    authState.role = "SUPER_ADMIN";

    render(<PurchaseOrdersPage />);

    expect(screen.getByRole("link", { name: /nueva orden/i })).toBeTruthy();
  });

  it("hides Nueva orden for MEMBER", () => {
    authState.role = "MEMBER";

    render(<PurchaseOrdersPage />);

    expect(screen.queryByRole("link", { name: /nueva orden/i })).toBeNull();
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
