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
  createCustomerMutateAsyncMock,
  updateCustomerMutateAsyncMock,
  deleteCustomerMutateAsyncMock,
  toastSuccessMock,
  toastErrorMock,
  moduleState,
} = vi.hoisted(() => ({
  createCustomerMutateAsyncMock: vi.fn(),
  updateCustomerMutateAsyncMock: vi.fn(),
  deleteCustomerMutateAsyncMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  moduleState: { enabled: true },
}));

vi.mock("./customer-vehicles", () => ({ CustomerVehicles: () => null }));

vi.mock("@/hooks/useBusinessModules", () => ({
  useVehiclesModule: () => ({ data: moduleState, isLoading: false }),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({
    data: {
      data: [
        {
          id: "cust-1",
          name: "Ana Perez",
          documentType: "CC",
          documentNumber: "123456",
          email: null,
          phone: null,
          address: null,
          segment: "OCCASIONAL" as const,
          active: true,
          referencia: "REF-001",
          placaMoto: "ABC-12D",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    isLoading: false,
  }),
  useCreateCustomer: () => ({
    mutateAsync: createCustomerMutateAsyncMock,
    isPending: false,
  }),
  useUpdateCustomer: () => ({
    mutateAsync: updateCustomerMutateAsyncMock,
    isPending: false,
  }),
  useDeleteCustomer: () => ({
    mutateAsync: deleteCustomerMutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "admin-1",
      role: "ADMIN",
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import CustomersPage from "./page";

describe("Customers page modal — customer-supplier-info-fields (T18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moduleState.enabled = true;
    createCustomerMutateAsyncMock.mockResolvedValue({} as never);
    updateCustomerMutateAsyncMock.mockResolvedValue({} as never);
    deleteCustomerMutateAsyncMock.mockResolvedValue({} as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("hides the motorcycle plate when the vehicles module is disabled", async () => {
    moduleState.enabled = false;
    const user = userEvent.setup();
    render(<CustomersPage />);
    expect(screen.queryByText("ABC-12D")).toBeNull();
    await user.click(screen.getByRole("button", { name: /nuevo cliente/i }));
    expect(screen.queryByLabelText(/Placa de la moto/i)).toBeNull();
    expect(screen.getByLabelText(/Referencia/i)).toBeTruthy();
  });

  it("renders Referencia and Placa de la moto and sends them to createCustomer", async () => {
    const user = userEvent.setup();
    render(<CustomersPage />);

    await user.click(screen.getByRole("button", { name: /nuevo cliente/i }));

    const referenciaInput = await screen.findByLabelText(/Referencia/i);
    expect(referenciaInput).toBeTruthy();
    expect(screen.getByLabelText(/Placa de la moto/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/Nombre/i), "Maria Test");
    await user.type(screen.getByLabelText(/Número de Documento/i), "9000");
    await user.type(referenciaInput, "REF-777");
    await user.type(screen.getByLabelText(/Placa de la moto/i), "XYZ-42");

    await user.click(screen.getByRole("button", { name: /^crear$/i }));

    await waitFor(() => {
      expect(createCustomerMutateAsyncMock).toHaveBeenCalled();
    });
    expect(createCustomerMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        referencia: "REF-777",
        placaMoto: "XYZ-42",
      })
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Cliente creado correctamente");
  });

  it("seeds referencia and placaMoto values when editing an existing customer", async () => {
    const user = userEvent.setup();
    render(<CustomersPage />);

    // Clicking the card (an ADMIN can edit) triggers handleEdit.
    await user.click(screen.getByText("Ana Perez"));

    const referenciaInput = await screen.findByLabelText(/Referencia/i);
    expect(referenciaInput).toHaveValue("REF-001");
    expect(screen.getByLabelText(/Placa de la moto/i)).toHaveValue("ABC-12D");
  });

  it("renders Referencia and Placa de la moto on the customer card", () => {
    render(<CustomersPage />);
    expect(screen.getByText("Ref: REF-001")).toBeTruthy();
    expect(screen.getByText("ABC-12D")).toBeTruthy();
  });
});
