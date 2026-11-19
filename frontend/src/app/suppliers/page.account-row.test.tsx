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
const ACCOUNT_NUMBER = "12345678901234567890";

function supplier(overrides: Record<string, unknown> = {}) {
  return {
    id: "supplier-1",
    name: SUPPLIER_NAME,
    documentNumber: "900123456",
    bank: "Davivienda",
    accountType: "SAVINGS",
    accountNumber: ACCOUNT_NUMBER,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockSuppliers(row: Record<string, unknown>) {
  useSuppliersMock.mockReturnValue({
    data: {
      data: [row],
      meta: { total: 1, page: 1, limit: 12, totalPages: 1 },
    },
    isLoading: false,
  });
}

describe("Suppliers card bank account row", () => {
  beforeEach(() => {
    window.localStorage.setItem("meperpos:view-mode:suppliers", "grid");
    mockSuppliers(supplier());
  });

  afterEach(() => {
    window.localStorage.removeItem("meperpos:view-mode:suppliers");
    cleanup();
  });

  it("shows the whole account number on its own line, next to the copy action", () => {
    render(<SuppliersPage />);

    const number = screen.getByText(ACCOUNT_NUMBER);
    // Nothing on the number may clip it: the point of the row is that it is readable.
    expect(number.className).not.toContain("truncate");
    expect(number.className).not.toContain("line-clamp");
    expect(number.className).toContain("tabular-nums");

    const copy = screen.getByRole("button", {
      name: `Copiar cuenta de ${SUPPLIER_NAME}`,
    });
    const accountRow = number.parentElement as HTMLElement;
    expect(accountRow.contains(copy)).toBe(true);

    // The bank identity line stays above it, so the number gets a full line.
    const chip = screen.getByText("Davivienda");
    const identityRow = chip.parentElement!.parentElement as HTMLElement;
    expect(identityRow).not.toBe(accountRow);
    expect(identityRow.contains(number)).toBe(false);
    expect(identityRow.parentElement).toBe(accountRow.parentElement);
  });

  it("keeps the account type, the bank and the deactivate action on the identity line", () => {
    render(<SuppliersPage />);

    const chip = screen.getByText("Davivienda");
    const identityContent = chip.parentElement as HTMLElement;
    const identityRow = identityContent.parentElement as HTMLElement;
    expect(identityContent.contains(screen.getByText("Ahorros"))).toBe(true);

    const deactivate = screen.getByRole("button", {
      name: `Desactivar ${SUPPLIER_NAME}`,
    });
    expect(deactivate.parentElement!.parentElement).toBe(identityRow);
  });

  it("adds no second line to a supplier without a bank account", () => {
    mockSuppliers(supplier({ bank: null, accountType: null, accountNumber: null }));
    render(<SuppliersPage />);

    expect(screen.getByText("Sin cuenta bancaria")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Copiar cuenta/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: `Desactivar ${SUPPLIER_NAME}` }),
    ).toBeInTheDocument();
  });
});
