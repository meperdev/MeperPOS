import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PurchaseOrder } from "@/types";
import { ReceiveItemsModal } from "./ReceiveItemsModal";

const mocks = vi.hoisted(() => ({
  submit: vi.fn().mockResolvedValue({ status: "RECEIVED" }),
  directory: vi.fn(),
}));
vi.mock("@/hooks/usePurchaseOrders", () => ({
  useReceivePurchaseOrder: () => ({
    mutateAsync: mocks.submit,
    isPending: false,
  }),
}));
vi.mock("@/hooks/useLocations", () => ({ useLocations: mocks.directory }));
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  mocks.submit.mockClear();
});

const order = {
  id: "po",
  orderNumber: 4,
  items: [{ id: "item", qtyOrdered: 1, qtyReceived: 0 }],
} as PurchaseOrder;

const confirm = () =>
  fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" }));

it.each([
  { data: undefined, isLoading: true },
  { data: [], isLoading: false },
  {
    data: [
      { id: "warehouse", name: "Almacén", type: "WAREHOUSE", isDefault: false },
    ],
    isLoading: false,
  },
])(
  "never submits a receipt without an accessible destination: %j",
  (directory) => {
    mocks.directory.mockReturnValue(directory);
    render(<ReceiveItemsModal order={order} isOpen onClose={vi.fn()} />);
    confirm();
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);

it("submits to the reachable principal site with the unchanged request", () => {
  mocks.directory.mockReturnValue({
    data: [{ id: "main", name: "Principal", type: "STORE", isDefault: true }],
    isLoading: false,
  });
  render(<ReceiveItemsModal order={order} isOpen onClose={vi.fn()} />);
  confirm();
  expect(mocks.submit).toHaveBeenCalledWith({
    id: "po",
    items: [{ itemId: "item", qtyReceivedNow: 1 }],
  });
});
