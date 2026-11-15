import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * S2 inventory real-pagination behavior tests (spec: inventory-pagination).
 *
 * RED gate: these describe the TARGET behavior — bounded requests (page
 * size, never 1000), page navigation, filter resets, empty/last page and
 * keepPreviousData during in-flight fetches. They fail against the
 * current limit:1000 page and pass after the S2 implementation.
 */

const useProductsMock = vi.fn();
let urlParams: URLSearchParams | null = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => urlParams,
}));
let productsResponse: {
  data: {
    data: ReturnType<typeof buildProduct>[];
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
  useCategories: () => ({
    data: {
      data: [
        { id: "cat-1", name: "General" },
        { id: "cat-2", name: "Dulces" },
      ],
    },
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "admin-1", role: "ADMIN", name: "Admin", email: "a@b.co" },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Error",
}));

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

vi.mock("@/components/ui/BentoSelect", () => ({
  BentoSelect: ({
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
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

import InventoryPage from "./page";

function buildProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: `prod-${overrides.name ?? "x"}`,
    name: (overrides.name as string) ?? "Producto",
    sku: "SKU-1",
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
    ...overrides,
  };
}

function setResponse(
  products: ReturnType<typeof buildProduct>[],
  meta?: Partial<{ total: number; totalPages: number }>,
) {
  productsResponse = {
    data: {
      data: products,
      meta: {
        total: meta?.total ?? products.length,
        page: 1,
        limit: 10,
        totalPages: meta?.totalPages ?? 1,
      },
    },
    isLoading: false,
    isFetching: false,
  };
}

function lastQuery(): Record<string, unknown> {
  return useProductsMock.mock.calls.at(-1)![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  urlParams = new URLSearchParams();
  setResponse([]);
  useProductsMock.mockImplementation(() => productsResponse);
});

afterEach(() => {
  cleanup();
});

describe("Inventory page — real pagination (S2)", () => {
  it("initializes the first bounded query from the low-stock URL and shows tracked zero stock", () => {
    urlParams = new URLSearchParams("filter=lowStock");
    setResponse([
      buildProduct({ name: "Agotado", stock: 0, minStock: 0, tracksStock: true, isLowStock: true }),
      buildProduct({ name: "Escaso", stock: 2, tracksStock: true, isLowStock: true }),
    ]);
    render(<InventoryPage />);

    expect(useProductsMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ page: 1, limit: 10, lowStock: true }),
    );
    expect(screen.getByRole("heading", { name: "Agotado" })).toBeInTheDocument();
    expect(screen.getByText("Escaso")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Stock bajo/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("synchronizes URL entry/removal at page 1 without clearing other filters or overriding manual toggles", () => {
    setResponse([buildProduct({ name: "Panela", isLowStock: true })], { total: 35, totalPages: 4 });
    const { rerender } = render(<InventoryPage />);
    fireEvent.change(screen.getByLabelText("Todas las categorías"), { target: { value: "cat-2" } });
    fireEvent.change(screen.getByPlaceholderText("Buscar por nombre, SKU..."), { target: { value: "Panela" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    urlParams = new URLSearchParams("filter=lowStock");
    rerender(<InventoryPage />);
    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, lowStock: true, categoryId: "cat-2", search: "Panela" }));
    fireEvent.click(screen.getByRole("button", { name: /^Stock bajo/ }));
    rerender(<InventoryPage />);
    expect(lastQuery().lowStock).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: /^Stock bajo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    urlParams = new URLSearchParams("filter=unknown");
    rerender(<InventoryPage />);
    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, categoryId: "cat-2", search: "Panela" }));
    expect(lastQuery().lowStock).toBeUndefined();
  });

  it("treats null search params as no URL filter and preserves manual toggles", () => {
    urlParams = null;
    const { rerender } = render(<InventoryPage />);

    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, limit: 10 }));
    expect(lastQuery().lowStock).toBeUndefined();
    expect(screen.getByRole("button", { name: /^Stock bajo/ })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /^Stock bajo/ }));
    rerender(<InventoryPage />);
    expect(lastQuery().lowStock).toBe(true);
    expect(screen.getByRole("button", { name: /^Stock bajo/ })).toHaveAttribute("aria-pressed", "true");

    urlParams = new URLSearchParams("filter=lowStock");
    rerender(<InventoryPage />);
    urlParams = null;
    rerender(<InventoryPage />);
    expect(lastQuery().lowStock).toBeUndefined();
    expect(screen.getByRole("button", { name: /^Stock bajo/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not activate low stock for an unrelated URL filter", () => {
    urlParams = new URLSearchParams("filter=unknown");
    render(<InventoryPage />);
    expect(lastQuery().lowStock).toBeUndefined();
  });
  it("every request is bounded to the page size (never 1000), filtered or not", () => {
    setResponse([buildProduct({ name: "Panela" })], { total: 30, totalPages: 3 });

    render(<InventoryPage />);
    expect(lastQuery()).toEqual(
      expect.objectContaining({ page: 1, limit: 10, orderBy: "name" }),
    );

    fireEvent.change(screen.getByLabelText("Todas las categorías"), {
      target: { value: "cat-2" },
    });
    expect(lastQuery().limit).toBe(10);
    expect(lastQuery().limit).not.toBe(1000);
    expect(lastQuery().categoryId).toBe("cat-2");

    fireEvent.click(screen.getByRole("button", { name: /^Stock bajo( ?\d+)?$/ }));
    expect(lastQuery().limit).toBe(10);
    expect(lastQuery().limit).not.toBe(1000);
    expect(lastQuery().lowStock).toBe(true);
  });

  it("next/previous navigation issues a bounded request for the adjacent page", () => {
    setResponse(
      [buildProduct({ name: "Panela" })],
      { total: 25, totalPages: 3 },
    );

    render(<InventoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(lastQuery()).toEqual(expect.objectContaining({ page: 2, limit: 10 }));

    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, limit: 10 }));
  });

  it("applying a filter from page 3 resets the query to page 1 — including after clearing it", () => {
    setResponse(
      [buildProduct({ name: "Panela" })],
      { total: 45, totalPages: 5 },
    );

    render(<InventoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(lastQuery().page).toBe(3);

    fireEvent.change(screen.getByLabelText("Todas las categorías"), {
      target: { value: "cat-2" },
    });
    expect(lastQuery()).toEqual(
      expect.objectContaining({ page: 1, categoryId: "cat-2", limit: 10 }),
    );

    fireEvent.change(screen.getByLabelText("Todas las categorías"), {
      target: { value: "" },
    });
    expect(lastQuery().page).toBe(1);
  });

  it("an empty result renders the empty state with controls reflecting a single page", () => {
    setResponse([], { total: 0, totalPages: 0 });

    render(<InventoryPage />);

    expect(screen.getByText("No hay productos aún")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Siguiente" }),
    ).not.toBeInTheDocument();
  });

  it("next is disabled on the last page", () => {
    setResponse(
      [buildProduct({ name: "Panela" })],
      { total: 20, totalPages: 2 },
    );

    render(<InventoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(lastQuery().page).toBe(2);
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeEnabled();
  });

  it("keeps previous rows visible and shows a loading indicator while a fetch is in flight", () => {
    const pageOneRows = [buildProduct({ name: "Panela" })];
    setResponse(pageOneRows, { total: 25, totalPages: 3 });

    const { rerender } = render(<InventoryPage />);
    expect(screen.getByText("Panela")).toBeInTheDocument();

    // User navigates: request for page 2 goes out while keepPreviousData
    // still serves the page-1 rows.
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    productsResponse = {
      ...productsResponse,
      isFetching: true,
    };
    rerender(<InventoryPage />);

    expect(screen.getByText("Panela")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Actualizando productos...");
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(screen.getByText("Panela").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();

    // Page-2 rows arrive: rows update and the indicator clears.
    setResponse([buildProduct({ name: "Arequipe" })], { total: 25, totalPages: 3 });
    rerender(<InventoryPage />);

    expect(screen.getByText("Arequipe")).toBeInTheDocument();
    expect(screen.queryByText("Panela")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Arequipe").closest("[aria-busy]")).toHaveAttribute("aria-busy", "false");
  });
});
