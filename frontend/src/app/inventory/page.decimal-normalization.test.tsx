import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Regression coverage for the real wire shape: the backend serializes Prisma
 * `Decimal` columns as JSON STRINGS ("15000.00"), so the product editor must
 * normalize them at its single seed point. Unlike page.product-form.test.tsx,
 * this file keeps the real `Input` and `CurrencyInput` — the inflation defect
 * only exists in the digit-stripping formatter, so a stubbed CurrencyInput
 * could not observe it. Only the app-level boundaries are mocked.
 */
const update = vi.fn().mockResolvedValue({});
const toastSuccess = vi.fn();
const toastError = vi.fn();
let products: ReturnType<typeof decimalProduct>[] = [];

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ data: { data: products, meta: { total: products.length, totalPages: 1 } }, isLoading: false, isFetching: false }),
  useCreateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProduct: () => ({ mutateAsync: update, isPending: false }),
  useDeactivateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactivateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadProductImage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadProductImageById: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: { data: [{ id: "cat-1", name: "General" }] } }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: "ADMIN" } }),
}));
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));
vi.mock("@/components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div role="dialog" aria-label="Editar producto">{children}</div> : null,
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/products/ProductCard", () => ({
  ProductCard: ({ product: item, onClick }: { product: { name: string }; onClick?: () => void }) => (
    <button onClick={onClick}>{item.name}</button>
  ),
}));
vi.mock("@/components/ui/ImageUpload", () => ({
  ImageUpload: () => <div data-testid="product-image" />,
}));
vi.mock("@/components/ui/BentoSelect", () => ({
  BentoSelect: ({ label, placeholder }: { label?: string; placeholder?: string }) => (
    <span aria-label={label || placeholder} />
  ),
}));

import InventoryPage from "./page";

const INVALID_PRICES_TOAST = "Revisa los precios y las cantidades antes de guardar";

/** The exact shape the API sends: every Decimal-backed field is a string. */
function decimalProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1", name: "Panela", sku: "PAN-1", barcode: null, description: null,
    type: "PRODUCT", costPrice: "9000.00", salePrice: "15000.00", taxRate: "19.00",
    stock: 8, minStock: 2, isLowStock: false, categoryId: "cat-1", imageUrl: null,
    promotionType: "FIXED_PRICE", promotionValue: "8000.00", active: true, version: 1,
    ...overrides,
  };
}

const openEdit = () => {
  fireEvent.click(screen.getByRole("button", { name: "Panela" }));
  return screen.getByRole("dialog", { name: "Editar producto" });
};

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
  products = [];
});
afterEach(cleanup);

describe("inventory product form with Decimal strings from the API", () => {
  it("displays Decimal strings as their real amount instead of an inflated one", () => {
    products = [decimalProduct()];
    render(<InventoryPage />);
    const dialog = openEdit();

    // 15000.00 must read as 15.000, never as the digit-stripped 1.500.000.
    // The real Input appends a required marker, so match the label by prefix.
    expect(within(dialog).getByLabelText(/^Precio de Venta/)).toHaveValue("15.000");
    expect(within(dialog).getByLabelText(/^Precio de Costo/)).toHaveValue("9.000");
    expect(within(dialog).getByLabelText("Impuesto (%)")).toHaveValue(19);
    expect(within(dialog).getByPlaceholderText("Valor")).toHaveValue("8.000");
    expect(dialog.textContent).not.toContain("1.500.000");
  });

  it("submits the edit with numeric prices instead of blocking on the guard", async () => {
    products = [decimalProduct()];
    render(<InventoryPage />);
    const dialog = openEdit();

    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));

    // A string price fails `Number.isFinite`, which used to block every save.
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(toastError).not.toHaveBeenCalledWith(INVALID_PRICES_TOAST);

    const payload = update.mock.calls[0][0].data;
    expect(payload).toEqual(
      expect.objectContaining({ costPrice: 9000, salePrice: 15000, taxRate: 19, promotionValue: 8000 }),
    );
    expect(typeof payload.costPrice).toBe("number");
    expect(typeof payload.salePrice).toBe("number");
    expect(typeof payload.promotionValue).toBe("number");
  });

  it("keeps a zero tax rate out of the tax input as an empty field", () => {
    products = [decimalProduct({ taxRate: "0.00" })];
    render(<InventoryPage />);
    const dialog = openEdit();
    expect(within(dialog).getByLabelText("Impuesto (%)")).toHaveValue(null);
  });
});
