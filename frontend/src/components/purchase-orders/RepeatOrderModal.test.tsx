import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { PurchaseOrder, Supplier } from "@/types";

const duplicateMutateAsyncMock = vi.fn();
const pushMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastInfoMock = vi.fn();
const onCloseMock = vi.fn();
let suppliersData: Supplier[] = [];

const supplier = (id: string, name: string): Supplier => ({
  id,
  name,
  documentNumber: `NIT-${id}`,
  active: true,
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
});

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title?: string;
    children: ReactNode;
    footer?: ReactNode;
  }) =>
    isOpen ? (
      <section>
        {title ? <h2>{title}</h2> : null}
        {children}
        {footer}
      </section>
    ) : null,
}));

vi.mock("@/components/ui/Select", () => ({
  Select: ({
    label,
    value,
    onChange,
    options,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: () => ({ data: { data: suppliersData }, isLoading: false }),
}));

vi.mock("@/hooks/usePurchaseOrders", () => ({
  useDuplicatePurchaseOrder: () => ({
    mutateAsync: duplicateMutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: toastInfoMock,
  }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

import { RepeatOrderModal } from "./RepeatOrderModal";

const order = {
  id: "po-1",
  orderNumber: 12,
  supplierId: "supplier-1",
  supplier: supplier("supplier-1", "Proveedor Andino"),
  status: "RECEIVED",
} as PurchaseOrder;

const created = (overrides: Record<string, unknown> = {}) => ({
  order: { id: "po-new", orderNumber: 13 },
  skippedItems: [],
  ...overrides,
});

describe("RepeatOrderModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suppliersData = [
      supplier("supplier-1", "Proveedor Andino"),
      supplier("supplier-2", "Distribuidora Caribe"),
    ];
    duplicateMutateAsyncMock.mockResolvedValue(created());
  });

  afterEach(() => {
    cleanup();
  });

  it("preselects the supplier of the repeated order, with no cost warning", () => {
    render(<RepeatOrderModal order={order} isOpen onClose={onCloseMock} />);

    expect(screen.getByLabelText("Proveedor")).toHaveValue("supplier-1");
    expect(screen.queryByText(/revisa los costos/i)).toBeNull();
  });

  it("repeats for the same supplier and lands on the new draft with the editor open", async () => {
    const user = userEvent.setup();
    render(<RepeatOrderModal order={order} isOpen onClose={onCloseMock} />);

    await user.click(screen.getByRole("button", { name: "Crear borrador" }));

    expect(duplicateMutateAsyncMock).toHaveBeenCalledWith({ id: "po-1" });
    expect(toastSuccessMock).toHaveBeenCalledWith("Borrador OC-13 creado");
    expect(toastInfoMock).not.toHaveBeenCalled();
    expect(onCloseMock).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/purchase-orders/po-new?edit=1");
  });

  it("warns about costs and repeats for another supplier", async () => {
    const user = userEvent.setup();
    render(<RepeatOrderModal order={order} isOpen onClose={onCloseMock} />);

    await user.selectOptions(screen.getByLabelText("Proveedor"), "supplier-2");

    expect(
      screen.getByText("Revisa los costos: son los de la última compra."),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Crear borrador" }));

    expect(duplicateMutateAsyncMock).toHaveBeenCalledWith({
      id: "po-1",
      supplierId: "supplier-2",
    });
  });

  it("tells which products were left out", async () => {
    const user = userEvent.setup();
    duplicateMutateAsyncMock.mockResolvedValue(
      created({
        skippedItems: [
          { productId: "p2", name: "Viejo", reason: "INACTIVE" },
          { productId: "p3", name: "Instalación", reason: "NOT_STOCKED" },
        ],
      }),
    );
    render(<RepeatOrderModal order={order} isOpen onClose={onCloseMock} />);

    await user.click(screen.getByRole("button", { name: "Crear borrador" }));

    expect(toastInfoMock).toHaveBeenCalledWith(
      "Quedaron por fuera: Viejo (inactivo), Instalación (no maneja inventario).",
    );
  });

  it("asks for another supplier when the original one is no longer active", () => {
    suppliersData = [supplier("supplier-2", "Distribuidora Caribe")];
    render(<RepeatOrderModal order={order} isOpen onClose={onCloseMock} />);

    expect(screen.getByLabelText("Proveedor")).toHaveValue("");
    expect(
      screen.getByText(
        "Proveedor Andino ya no está activo. Elige otro proveedor.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear borrador" })).toBeDisabled();
  });

  it("stays open on a failed repeat", async () => {
    const user = userEvent.setup();
    duplicateMutateAsyncMock.mockRejectedValue(new Error("boom"));
    render(<RepeatOrderModal order={order} isOpen onClose={onCloseMock} />);

    await user.click(screen.getByRole("button", { name: "Crear borrador" }));

    expect(toastErrorMock).toHaveBeenCalledWith("No se pudo repetir el pedido");
    expect(onCloseMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
