import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { getBogotaDateInputValue } from "@/lib/utils";

// The page derives its default month filter from the real current date
// (Bogotá timezone), so the expected month must be computed the same way.
// Hard-coding it here made these tests fail at every month rollover.
const CURRENT_MONTH = getBogotaDateInputValue().slice(0, 7);

const { exportDataMock } = vi.hoisted(() => ({ exportDataMock: vi.fn() }));

const useExpensesMock = vi.fn();
const useExpenseSummaryMock = vi.fn();
const useExpenseGroupsMock = vi.fn();
const useSuppliersMock = vi.fn();
const duplicateMutateAsyncMock = vi.fn();
const uploadReceiptMutateAsyncMock = vi.fn();
const { taxonomyMutationMock } = vi.hoisted(() => ({
  taxonomyMutationMock: () => ({ mutateAsync: vi.fn() }),
}));
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useExpenses", () => ({
  useExpenses: (params?: unknown) => useExpensesMock(params),
  useExpenseSummary: (month?: string) => useExpenseSummaryMock(month),
  useExpenseGroups: () => useExpenseGroupsMock(),
  useCreateExpenseGroup: taxonomyMutationMock,
  useUpdateExpenseGroup: taxonomyMutationMock,
  useDeleteExpenseGroup: taxonomyMutationMock,
  useCreateExpenseLabel: taxonomyMutationMock,
  useUpdateExpenseLabel: taxonomyMutationMock,
  useDeleteExpenseLabel: taxonomyMutationMock,
  useDuplicateExpense: () => ({ mutateAsync: duplicateMutateAsyncMock }),
  useUploadExpenseReceipt: () => ({ mutateAsync: uploadReceiptMutateAsyncMock }),
}));

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: () => useSuppliersMock(),
}));

vi.mock("@/components/expenses/ExpenseFormModal", () => ({
  ExpenseFormModal: () => <section>ExpenseFormModal</section>,
}));

vi.mock("@/components/expenses/AddPaymentModal", () => ({
  AddPaymentModal: () => <section>AddPaymentModal</section>,
}));

vi.mock("@/components/expenses/HistoryModal", () => ({
  HistoryModal: () => <section>HistoryModal</section>,
}));

vi.mock("@/components/expenses/ExpenseDetailModal", () => ({
  ExpenseDetailModal: () => <section>ExpenseDetailModal</section>,
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: "CASHIER" } }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      exportData: exportDataMock,
    },
  };
});

import ExpensesPage from "./page";

const expenseFixture = {
  id: "exp-1",
  organizationId: "org-1",
  labelId: "label-1",
  label: {
    id: "label-1",
    organizationId: "org-1",
    groupId: "group-1",
    name: "Arriendo",
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    group: {
      id: "group-1",
      organizationId: "org-1",
      name: "Gastos del local",
      active: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  },
  supplierId: null,
  purchaseOrderId: null,
  description: "Renta agosto",
  date: "2026-08-01T00:00:00.000Z",
  total: "500000",
  status: "PARTIAL",
  receiptUrl: null,
  active: true,
  createdById: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  payments: [
    {
      id: "pay-1",
      expenseId: "exp-1",
      organizationId: "org-1",
      amount: "300000",
      method: "CASH",
      date: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ],
};

const paidExpenseFixture = {
  ...expenseFixture,
  id: "exp-2",
  status: "PAID",
  description: "Renta julio",
  payments: [
    {
      id: "pay-2",
      expenseId: "exp-2",
      organizationId: "org-1",
      amount: "500000",
      method: "TRANSFER",
      date: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ],
};

describe("Expenses page evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportDataMock.mockResolvedValue(undefined);
    duplicateMutateAsyncMock.mockResolvedValue({} as never);
    uploadReceiptMutateAsyncMock.mockResolvedValue({} as never);

    useExpenseSummaryMock.mockReturnValue({
      data: {
        month: "2026-08",
        total: "800000",
        groups: [
          { groupId: "group-1", name: "Gastos del local", total: "500000", labels: [{ labelId: "label-1", name: "Arriendo", total: "500000" }] },
          { groupId: "group-2", name: "Caja menor", total: "300000", labels: [{ labelId: "label-2", name: "Compras menores", total: "300000" }] },
        ],
      },
      isLoading: false,
    });

    useExpensesMock.mockReturnValue({
      data: {
        data: [expenseFixture],
        meta: { total: 1, page: 1, limit: 15, totalPages: 1 },
      },
      isLoading: false,
    });

    useExpenseGroupsMock.mockReturnValue({
      data: [
        {
          id: "group-1",
          organizationId: "org-1",
          name: "Gastos del local",
          active: true,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          labels: [{ id: "label-1", organizationId: "org-1", groupId: "group-1", name: "Arriendo", active: true, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }],
        },
      ],
      isLoading: false,
    });

    useSuppliersMock.mockReturnValue({ data: { data: [] }, isLoading: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the month total and per-category summary cards (EXP-8)", () => {
    render(<ExpensesPage />);

    expect(screen.getByText("Total del mes")).toBeTruthy();
    expect(screen.getByText(/800\.000/)).toBeTruthy();
    expect(screen.getAllByText(/Arriendo/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Caja menor")).toBeTruthy();
    expect(useExpenseSummaryMock).toHaveBeenCalledWith(CURRENT_MONTH);
  });

  it("renders the expense list with status badge and COP totals", () => {
    render(<ExpensesPage />);

    expect(screen.getAllByText("Renta agosto").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Parcial").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/500\.000/).length).toBeGreaterThanOrEqual(1);
  });

  it("applies the month filter to the list query", () => {
    render(<ExpensesPage />);

    expect(useExpensesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ month: CURRENT_MONTH }),
    );

    fireEvent.change(screen.getByLabelText("Mes"), {
      target: { value: "2026-07" },
    });

    expect(useExpensesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ month: "2026-07", page: 1 }),
    );
  });

  it("exports the filtered list through the exports endpoint (EXP-9)", async () => {
    const user = userEvent.setup();

    render(<ExpensesPage />);

    await user.click(screen.getByRole("button", { name: /Exportar/i }));
    await user.click(screen.getByRole("button", { name: /Exportar archivo/i }));

    expect(exportDataMock).toHaveBeenCalledWith(
      "/exports/expenses",
      expect.objectContaining({ type: "expenses" }),
    );
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("opens the create form modal", async () => {
    const user = userEvent.setup();

    render(<ExpensesPage />);

    await user.click(screen.getByRole("button", { name: /Nuevo gasto/i }));

    expect(await screen.findByText("ExpenseFormModal")).toBeTruthy();
  });


async function openRowActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole("button", { name: "Más acciones" })[0]);
}

  it("opens the add payment modal from the row actions", async () => {
    const user = userEvent.setup();

    render(<ExpensesPage />);

    await openRowActions(user);
    await user.click(screen.getByRole("menuitem", { name: "Agregar pago" }));

    expect(await screen.findByText("AddPaymentModal")).toBeTruthy();
  });

  it("opens the history modal from the row actions", async () => {
    const user = userEvent.setup();

    render(<ExpensesPage />);

    await openRowActions(user);
    await user.click(screen.getByRole("menuitem", { name: "Ver historial" }));

    expect(await screen.findByText("HistoryModal")).toBeTruthy();
  });

  it("opens the expense detail modal from the row actions", async () => {
    const user = userEvent.setup();

    render(<ExpensesPage />);

    await user.click(screen.getAllByRole("button", { name: "Ver detalle" })[0]);

    expect(await screen.findByText("ExpenseDetailModal")).toBeTruthy();
  });

  it("keeps the add payment action enabled with the Agregar pago label for partial expenses", async () => {
    const user = userEvent.setup();

    render(<ExpensesPage />);
    await openRowActions(user);

    const item = screen.getByRole("menuitem", { name: "Agregar pago" });
    expect(item).not.toBeDisabled();
    expect(item).toHaveAttribute("title", "Agregar pago");
  });

  it("disables the add payment action and exposes the reason for paid expenses", async () => {
    useExpensesMock.mockReturnValue({
      data: {
        data: [paidExpenseFixture],
        meta: { total: 1, page: 1, limit: 15, totalPages: 1 },
      },
      isLoading: false,
    });

    const user = userEvent.setup();
    render(<ExpensesPage />);
    await openRowActions(user);

    const item = screen.getByRole("menuitem", {
      name: "La salida ya está pagada",
    });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("title", "La salida ya está pagada");
  });

  // Absence regression (EXP-5): the owner asked for the per-row delete
  // affordance to be removed from the interface. Assert the user-visible
  // affordance is gone, not how the page happens to be implemented.
  it("does not offer a per-row delete action (EXP-5)", () => {
    render(<ExpensesPage />);

    expect(
      screen.queryAllByRole("button", { name: "Eliminar gasto" }),
    ).toHaveLength(0);
    expect(screen.queryByText("Eliminar gasto")).toBeNull();
  });

  it("duplicates an expense after confirmation (EXP-10)", async () => {
    const user = userEvent.setup();

    render(<ExpensesPage />);

    await openRowActions(user);
    await user.click(screen.getByRole("menuitem", { name: "Duplicar gasto" }));
    expect(screen.getByText("Duplicar gasto")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Sí, duplicar" }));

    expect(duplicateMutateAsyncMock).toHaveBeenCalledWith("exp-1");
    expect(toastSuccessMock).toHaveBeenCalledWith("Gasto duplicado");
  });

  it("uploads a receipt from the row actions", async () => {
    const user = userEvent.setup();

    render(<ExpensesPage />);

    const file = new File(["receipt"], "recibo.png", { type: "image/png" });
    await openRowActions(user);
    const input = screen.getByLabelText("Subir comprobante");
    await user.upload(input, file);

    expect(uploadReceiptMutateAsyncMock).toHaveBeenCalledWith({
      id: "exp-1",
      file,
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Comprobante subido");
  });
});
