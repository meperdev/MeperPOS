import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const {
  createSupplierMutateAsyncMock,
  updateSupplierMutateAsyncMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  createSupplierMutateAsyncMock: vi.fn(),
  updateSupplierMutateAsyncMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

const { authState } = vi.hoisted(() => ({ authState: { role: "ADMIN" } }));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: () => ({
    data: {
      data: [
        {
          id: "sup-1",
          name: "Distribuidora Central",
          documentNumber: "900123456",
          email: null,
          phone: null,
          address: null,
          contactName: null,
          bank: "Bancolombia",
          active: true,
          accountNumber: "0111111111",
          accountType: "CHECKING",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    isLoading: false,
  }),
  useCreateSupplier: () => ({
    mutateAsync: createSupplierMutateAsyncMock,
    isPending: false,
  }),
  useUpdateSupplier: () => ({
    mutateAsync: updateSupplierMutateAsyncMock,
    isPending: false,
  }),
  useDeactivateSupplier: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactivateSupplier: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "admin-1",
      role: authState.role,
      name: "Admin",
      email: "admin@example.com",
    },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Error",
}));

import SuppliersPage from "./page";

describe("Suppliers page modal — customer-supplier-info-fields (T19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = "ADMIN";
    createSupplierMutateAsyncMock.mockResolvedValue({} as never);
    updateSupplierMutateAsyncMock.mockResolvedValue({} as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("sends bank, accountNumber and accountType (Ahorros/SAVINGS) to createSupplier", async () => {
    const user = userEvent.setup();
    render(<SuppliersPage />);

    await user.click(screen.getByRole("button", { name: /nuevo proveedor/i }));

    const accountNumberInput = await screen.findByLabelText(/Número de cuenta/i);
    expect(accountNumberInput).toBeTruthy();

    const selectTriggers = screen.getAllByRole("button", { name: /Seleccionar.../i });
    expect(selectTriggers.length).toBeGreaterThanOrEqual(2);

    const bankTrigger = selectTriggers[0];
    const accountTypeTrigger = selectTriggers[1];

    await user.type(screen.getByLabelText(/Nombre \/ Razón social/i), "Dist Test");
    await user.type(screen.getByLabelText(/NIT \/ Documento/i), "900");
    await user.type(accountNumberInput, "0112345678");

    await user.click(bankTrigger);
    await user.click(screen.getByText("Nequi"));

    await user.click(accountTypeTrigger);
    await user.click(screen.getByText("Ahorros"));

    await user.click(screen.getByRole("button", { name: /^crear$/i }));

    await waitFor(() => {
      expect(createSupplierMutateAsyncMock).toHaveBeenCalled();
    });
    expect(createSupplierMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bank: "Nequi",
        accountNumber: "0112345678",
        accountType: "SAVINGS",
      })
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Proveedor creado correctamente");
  });

  it("coerces whitespace accountNumber, bank and empty accountType to null", async () => {
    const user = userEvent.setup();
    render(<SuppliersPage />);

    await user.click(screen.getByRole("button", { name: /nuevo proveedor/i }));

    const accountNumberInput = await screen.findByLabelText(/Número de cuenta/i);

    await user.type(screen.getByLabelText(/Nombre \/ Razón social/i), "Dist Test");
    await user.type(screen.getByLabelText(/NIT \/ Documento/i), "900");
    await user.type(accountNumberInput, "   ");

    await user.click(screen.getByRole("button", { name: /^crear$/i }));

    await waitFor(() => {
      expect(createSupplierMutateAsyncMock).toHaveBeenCalled();
    });
    expect(createSupplierMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bank: null,
        accountNumber: null,
        accountType: null,
      })
    );
  });

  it("seeds bank, accountNumber and accountType (Corriente/CHECKING) when editing a supplier", async () => {
    const user = userEvent.setup();
    render(<SuppliersPage />);

    // Clicking the card (an ADMIN can manage) triggers handleEdit.
    await user.click(screen.getByText("Distribuidora Central"));

    const accountNumberInput = await screen.findByLabelText(/Número de cuenta/i);
    expect(accountNumberInput).toHaveValue("0111111111");
    // BentoSelect value=Bancolombia and value=CHECKING render their labels as the trigger text.
    expect(screen.getByRole("button", { name: /Bancolombia/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Corriente/i })).toBeTruthy();
  });

  it("renders bank badge and account type/number on the supplier card", () => {
    render(<SuppliersPage />);
    expect(screen.getByText("Bancolombia")).toBeTruthy();
    expect(screen.getByText("Corriente: 0111111111")).toBeTruthy();
  });
});

describe("Suppliers page — create action is gated by the role hierarchy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = "ADMIN";
  });

  afterEach(() => {
    cleanup();
  });

  it("shows Nuevo Proveedor for OWNER", () => {
    authState.role = "OWNER";

    render(<SuppliersPage />);

    expect(screen.getByRole("button", { name: /nuevo proveedor/i })).toBeTruthy();
  });

  it("shows Nuevo Proveedor for SUPER_ADMIN", () => {
    authState.role = "SUPER_ADMIN";

    render(<SuppliersPage />);

    expect(screen.getByRole("button", { name: /nuevo proveedor/i })).toBeTruthy();
  });

  it("hides Nuevo Proveedor for CASHIER", () => {
    authState.role = "CASHIER";

    render(<SuppliersPage />);

    expect(screen.queryByRole("button", { name: /nuevo proveedor/i })).toBeNull();
  });

  it("hides Nuevo Proveedor for MEMBER", () => {
    authState.role = "MEMBER";

    render(<SuppliersPage />);

    expect(screen.queryByRole("button", { name: /nuevo proveedor/i })).toBeNull();
  });
});
