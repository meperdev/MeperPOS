import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PurchaseOrder } from "@/types";

const pushMock = vi.fn();
const usePurchaseOrderMock = vi.fn();
const useConfirmPurchaseOrderMock = vi.fn();
const axiosIsAxiosErrorMock = vi.fn();

vi.mock("axios", () => ({
  default: {
    isAxiosError: (error: unknown) => axiosIsAxiosErrorMock(error),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: () => ({ id: "po-1" }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
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

vi.mock("@/components/purchase-orders/PurchaseOrderStatusBadge", () => ({
  PurchaseOrderStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("@/components/purchase-orders/ReceiveItemsModal", () => ({
  ReceiveItemsModal: () => <div>receive modal</div>,
}));

vi.mock("@/components/purchase-orders/CancelPurchaseOrderModal", () => ({
  CancelPurchaseOrderModal: () => <div>cancel modal</div>,
}));

vi.mock("@/components/purchase-orders/EditDraftModal", () => ({
  EditDraftModal: () => <div>edit modal</div>,
}));

vi.mock("@/hooks/usePurchaseOrders", () => ({
  usePurchaseOrder: (id: string) => usePurchaseOrderMock(id),
  useConfirmPurchaseOrder: () => useConfirmPurchaseOrderMock(),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", role: "ADMIN", name: "Admin", email: "admin@example.com" },
  }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "No se pudo cargar la orden de compra.",
}));

import PurchaseOrderDetailPage from "./page";

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
    createdBy: { id: "user-1", name: "Admin" },
    status: "PENDING",
    subtotal: 500,
    taxAmount: 95,
    total: 595,
    notes: "Urgente",
    confirmedAt: "2026-04-19T10:00:00.000Z",
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

describe("Purchase order detail page behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosIsAxiosErrorMock.mockReturnValue(false);
    useConfirmPurchaseOrderMock.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("hides cancellation for partially received orders", () => {
    usePurchaseOrderMock.mockReturnValue({
      data: makeOrder({ status: "PARTIAL_RECEIVED" }),
      isLoading: false,
      error: null,
    });

    render(<PurchaseOrderDetailPage />);

    expect(screen.queryByRole("button", { name: /Cancelar OC/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Recibir pendientes/i })).toBeTruthy();
  });

  it("shows a clean unavailable state on 404 errors", () => {
    const notFoundError = { response: { status: 404 } };
    axiosIsAxiosErrorMock.mockReturnValue(true);
    usePurchaseOrderMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: notFoundError,
    });

    render(<PurchaseOrderDetailPage />);

    expect(screen.getByText("No se pudo abrir la orden")).toBeTruthy();
    expect(
      screen.getByText("La orden de compra no existe o fue eliminada."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ir a órdenes/i })).toBeTruthy();
  });

  it("shows the items table only from the @2xl container breakpoint", () => {
    usePurchaseOrderMock.mockReturnValue({
      data: makeOrder(),
      isLoading: false,
      error: null,
    });

    render(<PurchaseOrderDetailPage />);

    const tableWrapper = screen.getByRole("table").closest(".overflow-x-auto");
    expect(tableWrapper).not.toBeNull();
    expect(tableWrapper!.className).toContain("hidden");
    expect(tableWrapper!.className).toContain("@2xl:block");
    expect(tableWrapper!.className).not.toContain("lg:");
  });

  it("renders a stacked list for narrow containers with the same figures", () => {
    usePurchaseOrderMock.mockReturnValue({
      data: makeOrder(),
      isLoading: false,
      error: null,
    });

    render(<PurchaseOrderDetailPage />);

    const list = screen.getByTestId("po-item-list");
    expect(list.className).toContain("@2xl:hidden");

    const row = within(list).getByTestId("po-item-row");
    expect(within(row).getByText("Producto Uno")).toBeTruthy();
    expect(within(row).getByText("SKU-1")).toBeTruthy();
    expect(within(row).getByText("2 / 5")).toBeTruthy();
    expect(within(row).getByText("19%")).toBeTruthy();
    expect(within(row).getByText(/595/)).toBeTruthy();
    expect(within(row).getByText("Recibido / Ordenado")).toBeTruthy();
    expect(within(row).getByText("Costo unit.")).toBeTruthy();
  });

  it("puts the cost summary beside the items only from the @4xl container breakpoint", () => {
    usePurchaseOrderMock.mockReturnValue({
      data: makeOrder(),
      isLoading: false,
      error: null,
    });

    render(<PurchaseOrderDetailPage />);

    const aside = screen.getByText("Resumen de costos").closest("aside");
    const grid = aside!.parentElement!;
    expect(grid.className).toContain("@container");
    expect(grid.className).toContain("@4xl:grid-cols-3");
    expect(grid.className).not.toContain("lg:grid-cols-3");
    expect(grid.firstElementChild!.className).toContain("@4xl:col-span-2");
    expect(grid.firstElementChild!.className).not.toContain("lg:col-span-2");
  });
});
