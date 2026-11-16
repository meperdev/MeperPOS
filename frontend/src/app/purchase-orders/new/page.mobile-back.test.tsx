import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import NewPurchaseOrderPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: () => ({ data: { data: [] }, isLoading: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/usePurchaseOrders", () => ({
  useCreatePurchaseOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

afterEach(cleanup);

describe("New purchase order page back affordance", () => {
  // S1.2: below lg the fixed top bar carries the back chevron, so the in-content
  // copy is hidden there and kept for the desktop rail layout.
  it("leaves the in-content back link to the mobile top bar", () => {
    render(<NewPurchaseOrderPage />);

    const back = screen.getByRole("link", { name: "Volver" });
    expect(back).toHaveAttribute("href", "/purchase-orders");
    expect(back).toHaveClass("hidden");
    expect(back).toHaveClass("lg:inline-flex");
  });

  it("still renders the page title and its empty draft state", () => {
    render(<NewPurchaseOrderPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Nueva orden de compra",
    );
  });
});
