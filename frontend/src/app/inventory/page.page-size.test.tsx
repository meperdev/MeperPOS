import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * The inventory card grid asks for as many cards as the viewport shows; the
 * table keeps its fixed page. RED gate: the page requests a hard-coded
 * `limit: 10` in both views and never re-maps the page on a size change.
 */

const useProductsMock = vi.fn();
const pageSizeMock = vi.fn();
let urlParams: URLSearchParams | null = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => urlParams,
}));

vi.mock("@/hooks/useResponsivePageSize", () => ({
  PAGE_SIZE_DEBOUNCE_MS: 150,
  useResponsivePageSize: (...args: unknown[]) => pageSizeMock(...args),
}));

let productsResponse: {
  data: {
    data: Array<Record<string, unknown>>;
    meta: { total: number; page: number; limit: number; totalPages: number };
  };
  isLoading: boolean;
  isFetching: boolean;
};

const mutationMock = () => ({ mutateAsync: vi.fn(), isPending: false });

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: (params?: unknown) => useProductsMock(params),
  useCreateProduct: () => mutationMock(),
  useUpdateProduct: () => mutationMock(),
  useDeactivateProduct: () => mutationMock(),
  useDeleteProduct: () => mutationMock(),
  useReactivateProduct: () => mutationMock(),
  useUploadProductImage: () => mutationMock(),
  useUploadProductImageById: () => mutationMock(),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: { data: [{ id: "cat-1", name: "General" }] } }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "admin-1", role: "ADMIN", name: "Admin", email: "a@b.co" },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({ getApiErrorMessage: () => "Error" }));

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <section>{children}</section> : null,
}));

vi.mock("@/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <section data-testid="confirm-dialog" /> : null,
}));

vi.mock("@/components/ui/ImageUpload", () => ({
  ImageUpload: () => <div data-testid="image-upload" />,
}));

vi.mock("@/components/ui/CurrencyInput", () => ({
  CurrencyInput: ({
    label,
    value,
    onChange,
  }: {
    label?: string;
    value?: number | string;
    onChange?: (value: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock("@/components/ui/Select", () => ({
  Select: ({
    value,
    onChange,
    options,
    label,
    placeholder,
  }: {
    value?: string;
    onChange?: (value: string) => void;
    options?: Array<{ value: string; label: string }>;
    label?: string;
    placeholder?: string;
  }) => (
    <select
      aria-label={label ?? placeholder ?? "select"}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import InventoryPage from "./page";

function buildProduct(index: number) {
  return {
    id: `prod-${index}`,
    name: `Producto ${index}`,
    sku: `SKU-${index}`,
    barcode: null,
    description: null,
    costPrice: 1000,
    salePrice: 2000,
    stock: 10,
    minStock: 5,
    imageUrl: null,
    categoryId: "cat-1",
    category: { id: "cat-1", name: "General" },
    active: true,
    version: 1,
  };
}

function setResponse(total = 170, totalPages = 17) {
  productsResponse = {
    data: {
      data: [buildProduct(1), buildProduct(2)],
      meta: { total, page: 1, limit: 10, totalPages },
    },
    isLoading: false,
    isFetching: false,
  };
}

function lastQuery(): Record<string, unknown> {
  return useProductsMock.mock.calls.at(-1)![0] as Record<string, unknown>;
}

function lastPageSizeOptions(): Record<string, unknown> {
  return pageSizeMock.mock.calls.at(-1)![0] as Record<string, unknown>;
}

function settleGridSize(pageSize: number, columns = 9, rows = 4) {
  pageSizeMock.mockReturnValue({ pageSize, columns, rows });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  urlParams = new URLSearchParams();
  setResponse();
  useProductsMock.mockImplementation(() => productsResponse);
  settleGridSize(36);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Inventory page — page size follows the viewport (card view)", () => {
  it("requests the size the grid computed instead of the fixed default", () => {
    render(<InventoryPage />);

    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, limit: 36 }));
    // The hook receives the product track and the range the endpoint accepts.
    expect(lastPageSizeOptions()).toEqual(
      expect.objectContaining({ minCardWidth: 160, gap: 16, min: 10, max: 100 }),
    );
  });

  it("requests the rows the table measured in table view", () => {
    window.localStorage.setItem("meperpos:view-mode:inventory", "table");
    settleGridSize(7, 0, 7);

    render(<InventoryPage />);

    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, limit: 7 }));
    expect(lastPageSizeOptions()).toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("keeps the first visible item on screen when the grid size changes", () => {
    settleGridSize(10, 2, 5);
    const { rerender } = render(<InventoryPage />);
    expect(lastQuery().limit).toBe(10);

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(lastQuery()).toEqual(expect.objectContaining({ page: 3, limit: 10 }));

    // The viewport grew: page 3 started at item 21, which is on page 2 of 20.
    settleGridSize(20, 4, 5);
    rerender(<InventoryPage />);

    expect(lastQuery()).toEqual(expect.objectContaining({ page: 2, limit: 20 }));
  });

  it("stays on the page when the first item is the first item of the new page", () => {
    settleGridSize(10, 2, 5);
    const { rerender } = render(<InventoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(lastQuery().page).toBe(2);

    // 10 -> 40: item 11 is the first item of page 1 with 40 per page.
    settleGridSize(40, 8, 5);
    rerender(<InventoryPage />);

    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, limit: 40 }));
  });

  it("issues one request per settled size, not one per render", () => {
    const { rerender } = render(<InventoryPage />);
    rerender(<InventoryPage />);
    rerender(<InventoryPage />);

    // Every render asks for the same page/limit, so React Query keys one request
    // out of them: a stable size must never fan out into a request storm.
    const shapes = new Set(
      useProductsMock.mock.calls.map((call) => JSON.stringify(call[0])),
    );
    expect(shapes.size).toBe(1);
    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, limit: 36 }));
  });

  it("shows the pager range for the computed page size", () => {
    render(<InventoryPage />);

    expect(screen.getByText(/Mostrando/)).toHaveTextContent("1 - 36");
  });
});
