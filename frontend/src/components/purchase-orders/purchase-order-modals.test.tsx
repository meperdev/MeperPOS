import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Product, PurchaseOrder, Supplier } from "@/types";

const cancelMutateAsyncMock = vi.fn();
const receiveMutateAsyncMock = vi.fn();
const updateMutateAsyncMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

const suppliersData: Supplier[] = [
  {
    id: "supplier-1",
    name: "Proveedor Andino",
    documentNumber: "900123456",
    active: true,
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
  },
];

const productsData: Product[] = [
  {
    id: "prod-1",
    name: "Producto Uno",
    sku: "SKU-1",
    barcode: null,
    description: null,
    costPrice: 100,
    salePrice: 150,
    taxRate: 19,
    stock: 10,
    minStock: 1,
    imageUrl: null,
    categoryId: "cat-1",
    active: true,
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
    version: 1,
  },
  {
    id: "prod-2",
    name: "Producto Dos",
    sku: "SKU-2",
    barcode: null,
    description: null,
    costPrice: 200,
    salePrice: 260,
    taxRate: 19,
    stock: 4,
    minStock: 1,
    imageUrl: null,
    categoryId: "cat-1",
    active: true,
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
    version: 1,
  },
];

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

vi.mock("@/hooks/usePurchaseOrders", () => ({
  useCancelPurchaseOrder: () => ({
    mutateAsync: cancelMutateAsyncMock,
    isPending: false,
  }),
  useReceivePurchaseOrder: () => ({
    mutateAsync: receiveMutateAsyncMock,
    isPending: false,
  }),
  useUpdatePurchaseOrder: () => ({
    mutateAsync: updateMutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: () => ({ data: { data: suppliersData }, isLoading: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ data: { data: productsData }, isLoading: false }),
}));

vi.mock("@/hooks/useLocations", () => ({
  useLocations: () => ({
    data: [
      { id: "site-a", name: "Sede centro", type: "STORE", isDefault: true },
      { id: "site-b", name: "Bodega norte", type: "WAREHOUSE", isDefault: false },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getApiErrorMessage: () => "Error",
  };
});

import { CancelPurchaseOrderModal } from "./CancelPurchaseOrderModal";
import { ReceiveItemsModal } from "./ReceiveItemsModal";
import { EditDraftModal } from "./EditDraftModal";

function makeOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: "po-1",
    orderNumber: 12,
    supplierId: "supplier-1",
    supplier: suppliersData[0],
    createdById: "user-1",
    createdBy: { id: "user-1", name: "Admin" },
    status: "DRAFT",
    subtotal: 500,
    taxAmount: 95,
    total: 595,
    notes: "Urgente",
    confirmedAt: null,
    receivedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-04-19T09:00:00.000Z",
    updatedAt: "2026-04-19T09:00:00.000Z",
    items: [
      {
        id: "poi-1",
        purchaseOrderId: "po-1",
        productId: "prod-1",
        product: { id: "prod-1", name: "Producto Uno", sku: "SKU-1" },
        qtyOrdered: 5,
        qtyReceived: 2,
        unitCost: 100,
        taxRate: 19,
        subtotal: 500,
        taxAmount: 95,
      },
    ],
    ...overrides,
  };
}

describe("Purchase order modals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelMutateAsyncMock.mockResolvedValue({} as never);
    receiveMutateAsyncMock.mockResolvedValue({
      ...makeOrder({ status: "PARTIAL_RECEIVED" }),
    } as never);
    updateMutateAsyncMock.mockResolvedValue({} as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("submits a trimmed cancel reason once it is valid", async () => {
    const user = userEvent.setup();

    render(
      <CancelPurchaseOrderModal
        orderId="po-1"
        orderNumber={12}
        isOpen
        onClose={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "  Pedido duplicado  ");
    await user.click(screen.getByRole("button", { name: /Cancelar orden/i }));

    expect(cancelMutateAsyncMock).toHaveBeenCalledWith({
      id: "po-1",
      reason: "Pedido duplicado",
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("OC-12 cancelada");
  });

  it("initializes receive inputs with pending quantities and submits only positive rows", async () => {
    const user = userEvent.setup();

    render(
      <ReceiveItemsModal
        order={makeOrder({ status: "PARTIAL_RECEIVED" })}
        isOpen
        onClose={vi.fn()}
      />,
    );

    const input = within(screen.getByRole("table")).getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("3");

    await user.clear(input);
    await user.type(input, "1");
    await user.click(screen.getByRole("button", { name: /Confirmar recepción/i }));

    expect(receiveMutateAsyncMock).toHaveBeenCalledWith({
      id: "po-1",
      items: [{ itemId: "poi-1", qtyReceivedNow: 1 }],
    });
  });

  it("renders receive rows as a stacked list with the same quantities", () => {
    render(
      <ReceiveItemsModal
        order={makeOrder({ status: "PARTIAL_RECEIVED" })}
        isOpen
        onClose={vi.fn()}
      />,
    );

    const list = within(screen.getByTestId("receive-item-list"));
    const input = list.getByLabelText("Cantidad a recibir de Producto Uno") as HTMLInputElement;
    expect(input.value).toBe("3");
    expect(list.getByText("Producto Uno")).toBeTruthy();
    expect(list.getByText("SKU-1")).toBeTruthy();
    expect(list.getByText("Ordenado")).toBeTruthy();
    expect(list.getByText("Ya recibido")).toBeTruthy();
    expect(list.getByText("Pendiente")).toBeTruthy();
  });

  it("shares receive quantities between the list and the table", async () => {
    const user = userEvent.setup();

    render(
      <ReceiveItemsModal
        order={makeOrder({ status: "PARTIAL_RECEIVED" })}
        isOpen
        onClose={vi.fn()}
      />,
    );

    const listInput = within(screen.getByTestId("receive-item-list")).getByLabelText(
      "Cantidad a recibir de Producto Uno",
    ) as HTMLInputElement;
    await user.clear(listInput);
    await user.type(listInput, "2");

    const tableInput = within(screen.getByRole("table")).getByLabelText(
      "Cantidad a recibir de Producto Uno",
    ) as HTMLInputElement;
    expect(tableInput.value).toBe("2");

    await user.click(screen.getByRole("button", { name: /Confirmar recepción/i }));
    expect(receiveMutateAsyncMock).toHaveBeenCalledWith({
      id: "po-1",
      items: [{ itemId: "poi-1", qtyReceivedNow: 2 }],
    });
  });

  it("keeps the default receipt request when the principal site is kept", async () => {
    const user = userEvent.setup();

    render(
      <ReceiveItemsModal
        order={makeOrder({ status: "PARTIAL_RECEIVED" })}
        isOpen
        onClose={vi.fn()}
      />,
    );

    // The form starts on the principal site, which is the server's own default.
    expect(
      screen.getByRole("button", { name: "Sede de destino" }),
    ).toHaveTextContent("Sede centro");

    await user.click(screen.getByRole("button", { name: /Confirmar recepción/i }));

    expect(receiveMutateAsyncMock).toHaveBeenCalledWith({
      id: "po-1",
      items: [{ itemId: "poi-1", qtyReceivedNow: 3 }],
    });
    expect(receiveMutateAsyncMock.mock.calls[0][0]).not.toHaveProperty("locationId");
  });

  it("sends the destination site the user chose", async () => {
    const user = userEvent.setup();

    render(
      <ReceiveItemsModal
        order={makeOrder({ status: "PARTIAL_RECEIVED" })}
        isOpen
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sede de destino" }));
    await user.click(await screen.findByRole("option", { name: /Bodega norte/ }));
    await user.click(screen.getByRole("button", { name: /Confirmar recepción/i }));

    expect(receiveMutateAsyncMock).toHaveBeenCalledWith({
      id: "po-1",
      items: [{ itemId: "poi-1", qtyReceivedNow: 3 }],
      locationId: "site-b",
    });
  });

  it("edits draft quantities from the stacked list and submits them", async () => {    const user = userEvent.setup();

    render(<EditDraftModal order={makeOrder()} isOpen onClose={vi.fn()} />);

    const list = within(screen.getByTestId("draft-item-list"));
    expect(list.getByText("Producto Uno")).toBeTruthy();
    expect(list.getByText("SKU-1")).toBeTruthy();

    const qty = list.getByLabelText("Cantidad de Producto Uno") as HTMLInputElement;
    expect(qty.value).toBe("5");
    await user.clear(qty);
    await user.type(qty, "7");

    const tableQty = within(screen.getByRole("table")).getByLabelText(
      "Cantidad de Producto Uno",
    ) as HTMLInputElement;
    expect(tableQty.value).toBe("7");

    await user.click(screen.getByRole("button", { name: /Guardar cambios/i }));
    expect(updateMutateAsyncMock).toHaveBeenCalledWith({
      id: "po-1",
      data: expect.objectContaining({
        items: [{ productId: "prod-1", qtyOrdered: 7, unitCost: 100, taxRate: 19 }],
      }),
    });
  });

  it("removes a product from the stacked list and shows the empty state there", async () => {
    const user = userEvent.setup();

    render(<EditDraftModal order={makeOrder()} isOpen onClose={vi.fn()} />);

    await user.click(
      within(screen.getByTestId("draft-item-list")).getByRole("button", {
        name: "Quitar Producto Uno",
      }),
    );

    expect(
      screen.getByText("Busca un producto para agregarlo"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Guardar cambios/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("boots draft editing state from the order snapshot on mount", async () => {
    const user = userEvent.setup();

    render(<EditDraftModal order={makeOrder()} isOpen onClose={vi.fn()} />);

    const table = within(screen.getByRole("table"));
    expect(screen.getByDisplayValue("Urgente")).toBeTruthy();
    expect(table.getByDisplayValue("5")).toBeTruthy();
    expect(table.getByText("Producto Uno")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    expect(updateMutateAsyncMock).toHaveBeenCalledWith({
      id: "po-1",
      data: {
        supplierId: "supplier-1",
        notes: "Urgente",
        items: [
          {
            productId: "prod-1",
            qtyOrdered: 5,
            unitCost: 100,
            taxRate: 19,
          },
        ],
      },
    });
  });

  // S10: the draft editor and the new-order page share ONE item editor, so a
  // product is searched and added the same way in both.
  it("adds a product to the draft from the same search popover", async () => {
    const user = userEvent.setup();

    render(<EditDraftModal order={makeOrder()} isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole("combobox", { name: /buscar producto/i }));
    await user.click(screen.getByRole("option", { name: /Producto Dos/i }));

    const list = within(screen.getByTestId("draft-item-list"));
    expect(list.getByText("Producto Dos")).toBeTruthy();
    // Both layouts render the row; whichever one is on screen takes the caret.
    expect(screen.getAllByLabelText("Cantidad de Producto Dos")).toContain(
      document.activeElement,
    );
  });

  it("keeps Cant. and IVA % columns wide enough without 2xl cell padding clipping digits", () => {
    render(<EditDraftModal order={makeOrder()} isOpen onClose={vi.fn()} />);

    const tableEl = screen.getByRole("table");
    const table = within(tableEl);
    const qtyHeader = table.getByRole("columnheader", { name: "Cant." });
    const taxHeader = table.getByRole("columnheader", { name: "IVA %" });
    expect(qtyHeader.className).toContain("w-28");
    expect(qtyHeader.className).toContain("min-w-28");
    expect(qtyHeader.className).toContain("2xl:px-2");
    expect(qtyHeader.className).not.toContain("2xl:px-5");
    expect(taxHeader.className).toContain("w-28");
    expect(taxHeader.className).toContain("min-w-28");
    expect(taxHeader.className).toContain("2xl:px-2");
    expect(taxHeader.className).not.toContain("2xl:px-5");

    const qtyCell = table.getByLabelText("Cantidad de Producto Uno").closest("td")!;
    const taxCell = table.getByLabelText("IVA de Producto Uno").closest("td")!;
    expect(qtyCell.className).toContain("2xl:px-2");
    expect(qtyCell.className).not.toContain("2xl:px-5");
    expect(taxCell.className).toContain("2xl:px-2");
    expect(taxCell.className).not.toContain("2xl:px-5");
    expect(table.getByLabelText("Cantidad de Producto Uno").className).toContain("pr-9");
    expect(table.getByLabelText("IVA de Producto Uno").className).toContain("pr-9");
  });
});
