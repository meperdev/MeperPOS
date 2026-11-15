import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const useSuppliersMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useSuppliers", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useSuppliers: (params: unknown) => useSuppliersMock(params),
    useCreateSupplier: mutation,
    useUpdateSupplier: mutation,
    useDeactivateSupplier: mutation,
    useReactivateSupplier: mutation,
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Error",
}));

import SuppliersPage from "./page";

const SUPPLIER_NAME = "Distribuidora Andina";

describe("Suppliers card footer", () => {
  beforeEach(() => {
    window.localStorage.setItem("meperpos:view-mode:suppliers", "grid");
    useSuppliersMock.mockReturnValue({
      data: {
        data: [
          {
            id: "supplier-1",
            name: SUPPLIER_NAME,
            documentNumber: "900123456",
            bank: "Bancolombia",
            accountType: "SAVINGS",
            accountNumber: "12345678901234567890",
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        meta: { total: 1, page: 1, limit: 12, totalPages: 1 },
      },
      isLoading: false,
    });
  });

  afterEach(() => {
    window.localStorage.removeItem("meperpos:view-mode:suppliers");
    cleanup();
  });

  it("renders the copy action frameless, like the delete action, at h-9 w-9", () => {
    render(<SuppliersPage />);

    const copy = screen.getByRole("button", { name: `Copiar cuenta de ${SUPPLIER_NAME}` });
    expect(copy.className).toContain("h-9");
    expect(copy.className).toContain("w-9");
    expect(copy.className).toContain("border-transparent");
    expect(copy.className).toContain("hover:bg-muted");
    expect(copy.className).not.toContain("bg-muted/40");
    expect(copy.className).not.toContain("border-border/60");
    expect(copy.className).toContain("focus-visible:ring-primary/40");
  });

  it("lays the supplier cards out on the shared intrinsic collection grid", () => {
    render(<SuppliersPage />);

    const grid = screen.getByRole("button", { name: `Copiar cuenta de ${SUPPLIER_NAME}` }).closest<HTMLElement>(".grid");
    expect(grid!.className).toContain("grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]");
    expect(grid!.className).not.toMatch(/(^|\s)(sm|md|lg|xl):grid-cols/);
  });

  it("lets the bank chip shrink and truncate instead of pushing the actions", () => {
    render(<SuppliersPage />);

    const chip = screen.getByText("Bancolombia");
    expect(chip.className).toContain("min-w-0");
    expect(chip.className).toContain("truncate");
    expect(chip.className).not.toContain("shrink-0");

    const left = chip.parentElement!;
    expect(left.className).toContain("min-w-0");
    expect(left.className).toContain("flex-1");
  });
});
