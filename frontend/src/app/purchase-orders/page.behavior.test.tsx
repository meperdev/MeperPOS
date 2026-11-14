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

vi.mock("@/components/ui/BentoSelect", () => ({
  BentoSelect: ({ placeholder }: { placeholder?: string }) => (
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

  it("shows Nueva OC for OWNER", () => {
    authState.role = "OWNER";

    render(<PurchaseOrdersPage />);

    expect(screen.getByRole("link", { name: /nueva oc/i })).toBeTruthy();
  });

  it("shows Nueva OC for SUPER_ADMIN", () => {
    authState.role = "SUPER_ADMIN";

    render(<PurchaseOrdersPage />);

    expect(screen.getByRole("link", { name: /nueva oc/i })).toBeTruthy();
  });

  it("hides Nueva OC for MEMBER", () => {
    authState.role = "MEMBER";

    render(<PurchaseOrdersPage />);

    expect(screen.queryByRole("link", { name: /nueva oc/i })).toBeNull();
  });

  it("hides Nueva OC for CASHIER", () => {
    authState.role = "CASHIER";

    render(<PurchaseOrdersPage />);

    expect(screen.queryByRole("link", { name: /nueva oc/i })).toBeNull();
  });
});
