import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { PurchaseOrder } from "@/types";

const confirmMutateAsyncMock = vi.fn();
const sendMutateAsyncMock = vi.fn();
const downloadMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const onCloseMock = vi.fn();

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

vi.mock("@/hooks/usePurchaseOrders", () => ({
  useConfirmPurchaseOrder: () => ({
    mutateAsync: confirmMutateAsyncMock,
    isPending: false,
  }),
  useSendPurchaseOrder: () => ({
    mutateAsync: sendMutateAsyncMock,
    isPending: false,
  }),
  downloadPurchaseOrderPdf: (order: unknown) => downloadMock(order),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

import { ConfirmSendModal } from "./ConfirmSendModal";

function makeOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: "po-1",
    orderNumber: 12,
    supplierId: "supplier-1",
    supplier: {
      id: "supplier-1",
      name: "Proveedor Andino",
      documentNumber: "900123456",
      active: true,
      createdAt: "2026-04-19T00:00:00.000Z",
      updatedAt: "2026-04-19T00:00:00.000Z",
    },
    createdById: "user-1",
    status: "DRAFT",
    subtotal: 500,
    taxAmount: 95,
    total: 595,
    createdAt: "2026-04-19T09:00:00.000Z",
    updatedAt: "2026-04-19T09:00:00.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const confirmButton = () => screen.getByRole("button", { name: /confirmar|confirmada/i });
const sendButton = () => screen.getByRole("button", { name: /^enviar/i });

describe("ConfirmSendModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMutateAsyncMock.mockResolvedValue(makeOrder({ status: "PENDING" }));
    downloadMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("joins both steps in one group and keeps Enviar off before confirming", () => {
    render(<ConfirmSendModal order={makeOrder()} isOpen onClose={onCloseMock} />);

    expect(
      screen.getByRole("group", { name: "Confirmar y enviar" }),
    ).toContainElement(sendButton());
    expect(confirmButton()).toBeEnabled();
    expect(sendButton()).toBeDisabled();
  });

  it("enables Enviar only once the server confirmed, sending the expected date", async () => {
    const user = userEvent.setup();
    const pending = deferred<PurchaseOrder>();
    confirmMutateAsyncMock.mockReturnValue(pending.promise);
    render(<ConfirmSendModal order={makeOrder()} isOpen onClose={onCloseMock} />);

    await user.type(screen.getByLabelText(/fecha de entrega esperada/i), "2026-11-25");
    await user.click(confirmButton());

    expect(confirmMutateAsyncMock).toHaveBeenCalledWith({
      id: "po-1",
      expectedDeliveryDate: "2026-11-25",
    });
    // Still waiting for the server: no timer can enable sending.
    expect(sendButton()).toBeDisabled();

    pending.resolve(makeOrder({ status: "PENDING" }));
    await screen.findByRole("button", { name: /confirmada/i });

    expect(confirmButton()).toBeDisabled();
    expect(sendButton()).toBeEnabled();
    expect(screen.getByLabelText(/fecha de entrega esperada/i)).toBeDisabled();
  });

  it("confirms without a date when none is chosen", async () => {
    const user = userEvent.setup();
    confirmMutateAsyncMock.mockResolvedValue(makeOrder({ status: "PENDING" }));
    render(<ConfirmSendModal order={makeOrder()} isOpen onClose={onCloseMock} />);

    await user.click(confirmButton());

    expect(confirmMutateAsyncMock).toHaveBeenCalledWith({ id: "po-1" });
  });

  it("keeps Enviar off when the confirmation fails", async () => {
    const user = userEvent.setup();
    confirmMutateAsyncMock.mockRejectedValue(new Error("boom"));
    render(<ConfirmSendModal order={makeOrder()} isOpen onClose={onCloseMock} />);

    await user.click(confirmButton());

    expect(toastErrorMock).toHaveBeenCalledWith("No se pudo confirmar la orden");
    expect(sendButton()).toBeDisabled();
    expect(confirmButton()).toBeEnabled();
  });

  it("records the send, downloads the PDF and closes", async () => {
    const user = userEvent.setup();
    confirmMutateAsyncMock.mockResolvedValue(makeOrder({ status: "PENDING" }));
    const order = makeOrder();
    render(<ConfirmSendModal order={order} isOpen onClose={onCloseMock} />);

    await user.click(confirmButton());
    await user.click(await screen.findByRole("button", { name: /^enviar/i }));

    expect(sendMutateAsyncMock).toHaveBeenCalledWith("po-1");
    expect(downloadMock).toHaveBeenCalledWith(order);
    expect(sendMutateAsyncMock.mock.invocationCallOrder[0]).toBeLessThan(
      downloadMock.mock.invocationCallOrder[0],
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "OC-12 enviada. Se descargó el PDF para el proveedor.",
    );
    expect(onCloseMock).toHaveBeenCalled();
  });

  it("opens on the second step for a confirmed order that was not sent", () => {
    render(
      <ConfirmSendModal
        order={makeOrder({
          status: "PENDING",
          expectedDeliveryDate: "2026-11-25T00:00:00.000Z",
        })}
        isOpen
        onClose={onCloseMock}
      />,
    );

    expect(confirmButton()).toBeDisabled();
    expect(sendButton()).toBeEnabled();
    expect(screen.getByLabelText(/fecha de entrega esperada/i)).toHaveValue(
      "2026-11-25",
    );
  });

  it("stays open and does not download when the send fails", async () => {
    const user = userEvent.setup();
    sendMutateAsyncMock.mockRejectedValue(new Error("boom"));
    render(
      <ConfirmSendModal
        order={makeOrder({ status: "PENDING" })}
        isOpen
        onClose={onCloseMock}
      />,
    );

    await user.click(sendButton());

    expect(toastErrorMock).toHaveBeenCalledWith("No se pudo enviar la orden");
    expect(downloadMock).not.toHaveBeenCalled();
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it("says the order was sent when only the download fails", async () => {
    const user = userEvent.setup();
    downloadMock.mockRejectedValue(new Error("network"));
    render(
      <ConfirmSendModal
        order={makeOrder({ status: "PENDING" })}
        isOpen
        onClose={onCloseMock}
      />,
    );

    await user.click(sendButton());

    expect(toastErrorMock).toHaveBeenCalledWith(
      "La orden quedó enviada, pero no se pudo descargar el PDF. Descárgalo desde el detalle.",
    );
  });
});
