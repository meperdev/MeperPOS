import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Sale } from "@/types";

const pushMock = vi.fn();
const useSaleMock = vi.fn();
const axiosIsAxiosErrorMock = vi.fn();

vi.mock("axios", () => ({
  default: {
    isAxiosError: (error: unknown) => axiosIsAxiosErrorMock(error),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: () => ({ id: "sale-1" }),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/Badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/Card", () => ({
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useSales", () => ({
  useSale: (id: string) => useSaleMock(id),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "No se pudo cargar el detalle de la venta.",
}));

vi.mock("@/hooks/useReceipt", () => ({
  downloadReceiptPdf: vi.fn(),
  openReceiptPdf: vi.fn(),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

import SaleDetailPage from "./page";

function makeSale(): Sale {
  return {
    id: "sale-1",
    saleNumber: 101,
    customerId: null,
    subtotal: 100000,
    taxAmount: 0,
    discountAmount: 0,
    total: 100000,
    amountPaid: 100000,
    change: 0,
    status: "COMPLETED",
    userId: "user-1",
    user: {
      id: "user-1",
      name: "Cajero Uno",
      email: "cajero@example.com",
    },
    items: [
      {
        id: "item-1",
        saleId: "sale-1",
        productId: "product-1",
        product: {
          id: "product-1",
          name: "Casco",
          sku: "SKU-1",
          barcode: null,
          description: null,
          costPrice: 50000,
          salePrice: 100000,
          taxRate: 0,
          stock: 10,
          minStock: 1,
          imageUrl: null,
          categoryId: "cat-1",
          active: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          version: 1,
        },
        quantity: 1,
        unitPrice: 100000,
        taxRate: 0,
        discountAmount: 0,
        subtotal: 100000,
        total: 100000,
      },
    ],
    payments: [
      {
        id: "pay-1",
        saleId: "sale-1",
        method: "CASH",
        amount: 100000,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
  };
}

describe("Recent-sales drill-down detail outcomes (#15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosIsAxiosErrorMock.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders authorized detail view for /sales/{id}", async () => {
    useSaleMock.mockReturnValue({
      data: makeSale(),
      isLoading: false,
      error: null,
    });

    render(<SaleDetailPage />);

    expect(screen.getByText("Detalle de venta")).toBeTruthy();
    expect(screen.getByText("#101")).toBeTruthy();
    expect(screen.getByText("Cajero Uno")).toBeTruthy();
  });

  it("shows clean denial UX for unauthorized detail access", async () => {
    const forbiddenError = { response: { status: 403 } };
    axiosIsAxiosErrorMock.mockReturnValue(true);

    useSaleMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: forbiddenError,
    });

    render(<SaleDetailPage />);

    expect(screen.getByText("No se pudo abrir la venta")).toBeTruthy();
    expect(screen.getByText("No tenes permisos para ver esta venta.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ir a Ventas" })).toBeTruthy();
  });
});
