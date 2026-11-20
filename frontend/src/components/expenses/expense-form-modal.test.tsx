import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { Expense } from "@/types";

// `vi.mock` factories are hoisted above the module body, so every mock they
// capture must be created inside `vi.hoisted`; a plain `const` is still in its
// temporal dead zone when the factory runs under the parallel suite.
const {
  createMutateAsyncMock,
  updateMutateAsyncMock,
  uploadReceiptMutateAsyncMock,
  invalidateExpenseDataMock,
  toastSuccessMock,
  toastErrorMock,
  usePurchaseOrdersMock,
  useSuppliersMock,
} = vi.hoisted(() => ({
  createMutateAsyncMock: vi.fn(),
  updateMutateAsyncMock: vi.fn(),
  uploadReceiptMutateAsyncMock: vi.fn(),
  invalidateExpenseDataMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  usePurchaseOrdersMock: vi.fn(),
  useSuppliersMock: vi.fn(),
}));

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children: ReactNode;
  }) =>
    isOpen ? (
      <section>
        {title ? <h2>{title}</h2> : null}
        {children}
      </section>
    ) : null,
}));

vi.mock("@/components/ui/Button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/ImageUpload", () => ({
  ImageUpload: ({ onUpload }: { onUpload: (file: File) => Promise<string> }) => (
    <button
      type="button"
      onClick={() =>
        void onUpload(new File(["receipt"], "comprobante.jpg", { type: "image/jpeg" }))
      }
    >
      Adjuntar comprobante
    </button>
  ),
}));

vi.mock("@/hooks/useExpenses", () => ({
  invalidateExpenseData: (...args: unknown[]) =>
    invalidateExpenseDataMock(...args),
  useExpenseGroups: () => ({
    data: [
      {
        id: "group-1",
        organizationId: "org-1",
        name: "Gastos del local",
        active: true,
        labels: [{ id: "label-1", groupId: "group-1", name: "Arriendo", active: true }],
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        organizationId: "org-1",
        name: "Caja menor",
        active: true,
        labels: [{ id: "label-2", groupId: "group-2", name: "Compras menores", active: true }],
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
  }),
  useCreateExpense: () => ({
    mutateAsync: createMutateAsyncMock,
    isPending: false,
  }),
  useUpdateExpense: () => ({
    mutateAsync: updateMutateAsyncMock,
    isPending: false,
  }),
  useUploadExpenseReceipt: () => ({
    mutateAsync: uploadReceiptMutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: (params: unknown) => useSuppliersMock(params),
}));

vi.mock("@/hooks/usePurchaseOrders", () => ({
  usePurchaseOrders: (params: unknown) => usePurchaseOrdersMock(params),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {},
  // Mirror the real helper: a server message wins, else the caller's fallback.
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

import { ExpenseFormModal } from "./ExpenseFormModal";

/** The form refreshes the expense queries through the query client. */
function renderModal(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

/** Fills the create form to the point where only the submit is missing. */
async function fillCreateForm(user: ReturnType<typeof userEvent.setup>) {
  await pickGroup(user, "Gastos del local");
  await pickLabel(user, "Arriendo");
  fireEvent.change(screen.getByLabelText("Fecha"), {
    target: { value: "2026-08-10" },
  });
  fireEvent.change(screen.getByPlaceholderText("Total del gasto"), {
    target: { value: "500000" },
  });
  fireEvent.change(screen.getByPlaceholderText("Valor del pago"), {
    target: { value: "500000" },
  });
}

/**
 * Select renders as a trigger <button> (not a native <select>), so the
 * option is picked by opening the popover and clicking the option label.
 */
async function pickGroup(
  user: ReturnType<typeof userEvent.setup>,
  group: string,
) {
  await user.click(screen.getByRole("button", { name: "Grupo" }));
  await user.click(screen.getByText(group));
}

async function pickLabel(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(screen.getByRole("button", { name: "Etiqueta" }));
  await user.click(screen.getByText(label));
}

function makeExpense(): Expense {
  return {
    id: "exp-1",
    organizationId: "org-1",
    labelId: "label-1",
    label: {
      id: "label-1",
      groupId: "group-1",
      organizationId: "org-1",
      name: "Arriendo",
      active: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
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
    // Decimal fields arrive as strings at runtime (backend Decimal serialization)
  } as unknown as Expense;
}

describe("ExpenseFormModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMutateAsyncMock.mockResolvedValue({ id: "exp-1" } as never);
    updateMutateAsyncMock.mockResolvedValue({} as never);
    uploadReceiptMutateAsyncMock.mockResolvedValue({} as never);
    useSuppliersMock.mockReturnValue({ data: { data: [] }, isLoading: false });
    usePurchaseOrdersMock.mockReturnValue({ data: { data: [] }, isLoading: false });
    // jsdom has no object URLs; the create form previews the pending receipt.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:comprobante"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("submits a create payload with the inline first payment", async () => {
    const user = userEvent.setup();

    renderModal(<ExpenseFormModal isOpen onClose={vi.fn()} />);

    await pickGroup(user, "Gastos del local");
    await pickLabel(user, "Arriendo");
    fireEvent.change(screen.getByLabelText("Fecha"), {
      target: { value: "2026-08-10" },
    });
    fireEvent.change(screen.getByPlaceholderText("Total del gasto"), {
      target: { value: "500000" },
    });
    fireEvent.change(screen.getByPlaceholderText("Valor del pago"), {
      target: { value: "500000" },
    });
    await user.click(screen.getByRole("button", { name: /Registrar gasto/i }));

    expect(createMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(createMutateAsyncMock).toHaveBeenCalledWith({
      labelId: "label-1",
      supplierId: undefined,
      purchaseOrderId: undefined,
      description: undefined,
      date: "2026-08-10",
      total: 500000,
      payments: [
        { amount: 500000, method: "CASH", date: expect.any(String) },
      ],
    });
    expect(createMutateAsyncMock.mock.calls[0][0]).not.toHaveProperty("categoryId");
    expect(toastSuccessMock).toHaveBeenCalledWith("Gasto registrado");
    // One save, one refresh: the create no longer invalidates on its own.
    expect(invalidateExpenseDataMock).toHaveBeenCalledTimes(1);
  });

  it("blocks submission when there is no valid payment (EXP-1)", async () => {
    const user = userEvent.setup();

    renderModal(<ExpenseFormModal isOpen onClose={vi.fn()} />);

    await pickGroup(user, "Gastos del local");
    await pickLabel(user, "Arriendo");
    fireEvent.change(screen.getByLabelText("Fecha"), {
      target: { value: "2026-08-10" },
    });
    fireEvent.change(screen.getByPlaceholderText("Total del gasto"), {
      target: { value: "500000" },
    });
    await user.click(screen.getByRole("button", { name: /Registrar gasto/i }));

    expect(
      screen.getByText("Agrega al menos un pago válido"),
    ).toBeInTheDocument();
    expect(createMutateAsyncMock).not.toHaveBeenCalled();
  });

  it("blocks submission when payments exceed the total (EXP-2 overpayment guard)", async () => {
    const user = userEvent.setup();

    renderModal(<ExpenseFormModal isOpen onClose={vi.fn()} />);

    await pickGroup(user, "Gastos del local");
    await pickLabel(user, "Arriendo");
    fireEvent.change(screen.getByLabelText("Fecha"), {
      target: { value: "2026-08-10" },
    });
    fireEvent.change(screen.getByPlaceholderText("Total del gasto"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByPlaceholderText("Valor del pago"), {
      target: { value: "200" },
    });
    await user.click(screen.getByRole("button", { name: /Registrar gasto/i }));

    expect(
      screen.getByText("El total de pagos supera el total del gasto"),
    ).toBeInTheDocument();
    expect(createMutateAsyncMock).not.toHaveBeenCalled();
  });

  it("starts with the label select disabled until a group is selected", async () => {
    renderModal(<ExpenseFormModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Grupo" })).toHaveTextContent("Selecciona un grupo");
    expect(screen.getByRole("button", { name: "Etiqueta" })).toBeDisabled();
  });

  it("filters labels by group and clears the label when the group changes", async () => {
    const user = userEvent.setup();
    renderModal(<ExpenseFormModal isOpen onClose={vi.fn()} />);

    await pickGroup(user, "Gastos del local");
    await user.click(screen.getByRole("button", { name: "Etiqueta" }));
    expect(screen.getByText("Arriendo")).toBeInTheDocument();
    expect(screen.queryByText("Compras menores")).not.toBeInTheDocument();
    await user.click(screen.getByText("Arriendo"));

    await user.click(screen.getByRole("button", { name: "Grupo" }));
    await user.click(screen.getByText("Caja menor"));

    expect(screen.getByRole("button", { name: "Etiqueta" })).toHaveTextContent("Selecciona una etiqueta");
    expect(screen.getByRole("button", { name: "Etiqueta" })).not.toHaveTextContent("Arriendo");
  });

  it("boots edit mode from the expense snapshot and submits an update", async () => {
    const user = userEvent.setup();

    renderModal(
      <ExpenseFormModal
        isOpen
        expense={makeExpense()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Grupo" })).toHaveTextContent("Gastos del local");
    expect(screen.getByRole("button", { name: "Etiqueta" })).toHaveTextContent("Arriendo");
    expect(screen.getByDisplayValue("Renta agosto")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Descripción (opcional)"), {
      target: { value: "Renta septiembre" },
    });
    await user.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    expect(updateMutateAsyncMock).toHaveBeenCalledWith({
      id: "exp-1",
      data: {
        labelId: "label-1",
        supplierId: null,
        purchaseOrderId: null,
        description: "Renta septiembre",
        date: "2026-08-01",
        total: 500000,
      },
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Gasto actualizado");
  });

  it("blocks an edit whose new total is below the sum of payments (EXP-5)", async () => {
    const user = userEvent.setup();

    renderModal(
      <ExpenseFormModal
        isOpen
        expense={makeExpense()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Total del gasto"), {
      target: { value: "200000" },
    });
    await user.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    expect(
      screen.getByText("El nuevo total no puede ser menor a los pagos registrados"),
    ).toBeInTheDocument();
    expect(updateMutateAsyncMock).not.toHaveBeenCalled();
  });

  it("shows the saving step and freezes the form while the expense is being created", async () => {
    const user = userEvent.setup();
    let resolveCreate: ((value: unknown) => void) | undefined;
    createMutateAsyncMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const onClose = vi.fn();

    renderModal(<ExpenseFormModal isOpen onClose={onClose} />);
    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: /Registrar gasto/i }));

    const saving = await screen.findByRole("button", {
      name: /Guardando gasto/i,
    });
    expect(saving).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    // Nothing can be edited or closed while the request is in flight.
    expect(screen.getByRole("button", { name: "Grupo" })).toBeDisabled();
    expect(screen.getByLabelText("Fecha")).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(invalidateExpenseDataMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate?.({ id: "exp-9" });
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(invalidateExpenseDataMock).toHaveBeenCalledTimes(1);
  });

  it("holds one busy state through the receipt upload and closes only when it settles", async () => {
    const user = userEvent.setup();
    let resolveUpload: ((value: unknown) => void) | undefined;
    uploadReceiptMutateAsyncMock.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    const onClose = vi.fn();

    renderModal(<ExpenseFormModal isOpen onClose={onClose} />);
    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Adjuntar comprobante" }));
    await user.click(screen.getByRole("button", { name: /Registrar gasto/i }));

    const uploading = await screen.findByRole("button", {
      name: /Subiendo comprobante/i,
    });
    expect(uploading).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    // The slow upload is visible, and nothing has been announced or closed yet.
    expect(onClose).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(invalidateExpenseDataMock).not.toHaveBeenCalled();
    expect(uploadReceiptMutateAsyncMock).toHaveBeenCalledWith({
      id: "exp-1",
      file: expect.any(File),
    });

    await act(async () => {
      resolveUpload?.({ receiptUrl: "https://cdn.test/comprobante.jpg" });
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastSuccessMock).toHaveBeenCalledWith("Gasto registrado");
    // Create + upload, but a single refresh, after both settled.
    expect(invalidateExpenseDataMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the created expense when the receipt fails and never asks for a retry", async () => {
    const user = userEvent.setup();
    uploadReceiptMutateAsyncMock.mockRejectedValue(new Error("upload failed"));
    const onClose = vi.fn();

    renderModal(<ExpenseFormModal isOpen onClose={onClose} />);
    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Adjuntar comprobante" }));
    await user.click(screen.getByRole("button", { name: /Registrar gasto/i }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "El gasto se registró, pero no se pudo subir el comprobante. Puedes adjuntarlo después desde la lista",
      ),
    );
    // The expense was saved: one success story, no repeated create.
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(createMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(invalidateExpenseDataMock).toHaveBeenCalledTimes(1);
  });

  it("lists only the chosen supplier's linkable orders and explains the consequence", async () => {
    const user = userEvent.setup();
    useSuppliersMock.mockReturnValue({
      data: {
        data: [
          { id: "sup-1", name: "Importadora Andina" },
          { id: "sup-2", name: "Ferretería Central" },
        ],
        isLoading: false,
      },
    });
    usePurchaseOrdersMock.mockReturnValue({
      data: {
        data: [
          {
            id: "po-1",
            orderNumber: 12,
            supplierId: "sup-1",
            status: "PENDING",
            total: "1000000",
            createdAt: "2026-11-14T10:00:00.000Z",
          },
          {
            id: "po-2",
            orderNumber: 13,
            supplierId: "sup-1",
            status: "DRAFT",
            total: "500000",
            createdAt: "2026-11-13T10:00:00.000Z",
          },
          {
            id: "po-3",
            orderNumber: 14,
            supplierId: "sup-2",
            status: "RECEIVED",
            total: "200000",
            createdAt: "2026-11-12T10:00:00.000Z",
          },
          {
            id: "po-4",
            orderNumber: 15,
            supplierId: "sup-1",
            status: "RECEIVED",
            total: "300000",
            createdAt: "2026-11-15T10:00:00.000Z",
          },
        ],
        isLoading: false,
      },
    });

    renderModal(<ExpenseFormModal isOpen onClose={vi.fn()} />);

    // Without a supplier the field is inert and asks for one first.
    expect(screen.getByRole("button", { name: "Orden de compra" })).toBeDisabled();
    expect(
      screen.getByText("Elige un proveedor para ligar una orden de compra."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Proveedor" }));
    await user.click(screen.getByText("Importadora Andina"));

    expect(usePurchaseOrdersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ supplierId: "sup-1" }),
    );
    expect(
      screen.getByText(
        "Al ligarla, este gasto cuenta como pago de mercancía y no como gasto operativo.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Orden de compra" }));

    // Newest first, and only this supplier's pending/received orders.
    expect(screen.getByText(/OC-15/)).toBeInTheDocument();
    expect(screen.getByText(/OC-12/)).toBeInTheDocument();
    expect(screen.queryByText(/OC-13/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OC-14/)).not.toBeInTheDocument();
  });

  it("clears the linked order when the supplier changes", async () => {
    const user = userEvent.setup();
    useSuppliersMock.mockReturnValue({
      data: {
        data: [
          { id: "sup-1", name: "Importadora Andina" },
          { id: "sup-2", name: "Ferretería Central" },
        ],
        isLoading: false,
      },
    });
    usePurchaseOrdersMock.mockReturnValue({
      data: {
        data: [
          {
            id: "po-1",
            orderNumber: 12,
            supplierId: "sup-1",
            status: "PENDING",
            total: "1000000",
            createdAt: "2026-11-14T10:00:00.000Z",
          },
          {
            id: "po-4",
            orderNumber: 16,
            supplierId: "sup-2",
            status: "RECEIVED",
            total: "300000",
            createdAt: "2026-11-15T10:00:00.000Z",
          },
        ],
        isLoading: false,
      },
    });

    renderModal(
      <ExpenseFormModal
        isOpen
        expense={
          {
            ...makeExpense(),
            supplierId: "sup-1",
            purchaseOrderId: "po-1",
          } as Expense
        }
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Orden de compra" })).toHaveTextContent(
      "OC-12",
    );

    await user.click(screen.getByRole("button", { name: "Proveedor" }));
    await user.click(screen.getByText("Ferretería Central"));

    expect(screen.getByRole("button", { name: "Orden de compra" })).toHaveTextContent(
      "Sin orden de compra",
    );

    await user.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    expect(updateMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: "sup-2",
          purchaseOrderId: null,
        }),
      }),
    );
  });
});
