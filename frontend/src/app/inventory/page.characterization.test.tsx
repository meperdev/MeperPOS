import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Characterization (approval) tests for the inventory page.
 *
 * They lock the page's CURRENT behavior BEFORE any S2 pagination change:
 * list rendering, search/category/status/low-stock filters and the
 * client-side name sort. Request-shape specifics (page/limit) are
 * intentionally NOT locked here — pagination behavior is covered by
 * page.pagination.test.tsx.
 */

const { authState } = vi.hoisted(() => ({ authState: { role: "ADMIN" } }));

const useProductsMock = vi.fn();
let productsResponse: {
  data: {
    data: ReturnType<typeof buildProduct>[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      lowStockCount: number;
    };
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
    user: { id: "admin-1", role: authState.role, name: "Admin", email: "a@b.co" },
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
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

// T22: the page reads the caller's sites and, in the editor, the per-site
// breakdown. These suites pin the aggregate list, so both answer empty.
vi.mock("@/hooks/useLocations", () => ({
  useLocations: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useProductStock", () => ({
  productStockQueryKey: (productId: string) => ["product-stock", productId],
  useProductStockBySite: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAdjustProductStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    // The server ships the low-stock flag; the page reads it instead of re-deriving
    // the rule, so fixtures must declare it the way a real response would.
    isLowStock: false,
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
  meta?: Partial<{ total: number; totalPages: number; lowStockCount: number }>,
) {
  productsResponse = {
    data: {
      data: products,
      meta: {
        total: meta?.total ?? products.length,
        page: 1,
        limit: 10,
        totalPages: meta?.totalPages ?? 1,
        // The badge reads the server's low-stock total, so a fixture that does not
        // state it defaults to the flagged rows it contains.
        lowStockCount:
          meta?.lowStockCount ??
          products.filter((product) => product.isLowStock === true).length,
      },
    },
    isLoading: false,
    isFetching: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.role = "ADMIN";
  setResponse([]);
  useProductsMock.mockImplementation(() => productsResponse);
});

afterEach(() => {
  cleanup();
});

describe("Inventory page — characterization (current behavior)", () => {
  it("renders the fetched products as cards with the total badge", () => {
    setResponse([
      buildProduct({ name: "Panela" }),
      buildProduct({ name: "Arequipe" }),
      buildProduct({ name: "Bocadillo" }),
    ]);

    render(<InventoryPage />);

    expect(screen.getByText("Panela")).toBeInTheDocument();
    expect(screen.getByText("Arequipe")).toBeInTheDocument();
    expect(screen.getByText("Bocadillo")).toBeInTheDocument();
    expect(screen.getByText("3 productos")).toBeInTheDocument();
  });

  it("keeps the product row free of tab stops and opens its edit form from a real name button", async () => {
    window.localStorage.setItem("meperpos:view-mode:inventory", "table");
    setResponse([buildProduct({ name: "Panela" })]);

    render(<InventoryPage />);

    const row = screen.getByText("Panela").closest("tr")!;
    expect(row).not.toHaveAttribute("tabindex");
    const edit = within(row).getByRole("button", { name: "Editar Panela" });
    expect(edit.tagName).toBe("BUTTON");
    fireEvent.click(edit);
    // The Modal is mocked to render only its children, so the open form is the observable effect.
    expect(await screen.findByDisplayValue("Panela")).toBeInTheDocument();
    window.localStorage.removeItem("meperpos:view-mode:inventory");
  });

  it("forwards the search term to the products query", () => {
    render(<InventoryPage />);

    fireEvent.change(screen.getByPlaceholderText("Buscar por nombre, SKU..."), {
      target: { value: "panela" },
    });

    const lastCall = useProductsMock.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(lastCall.search).toBe("panela");
  });

  it("forwards the selected category to the products query", () => {
    render(<InventoryPage />);

    fireEvent.change(screen.getByLabelText("Todas las categorías"), {
      target: { value: "cat-2" },
    });

    const lastCall = useProductsMock.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(lastCall.categoryId).toBe("cat-2");
  });

  it("forwards the status filter to the products query", () => {
    render(<InventoryPage />);

    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "inactive" },
    });

    const lastCall = useProductsMock.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(lastCall.status).toBe("inactive");
  });

  it("low-stock toggle shows only the products the server flagged (client-side)", () => {
    setResponse([
      buildProduct({ name: "Panela Baja", stock: 2, minStock: 5, isLowStock: true }),
      buildProduct({ name: "Dulce Sano", stock: 9, minStock: 5, isLowStock: false }),
    ]);

    render(<InventoryPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /^Stock bajo( ?\d+)?$/ }),
    );

    expect(screen.getByText("Panela Baja")).toBeInTheDocument();
    expect(screen.queryByText("Dulce Sano")).not.toBeInTheDocument();
    expect(screen.getByText("stock bajo")).toBeInTheDocument();
  });

  it("sorts the visible products by name regardless of server order", () => {
    setResponse([
      buildProduct({ name: "Zeta" }),
      buildProduct({ name: "Alfa" }),
      buildProduct({ name: "Mango" }),
    ]);

    render(<InventoryPage />);

    const zeta = screen.getByText("Zeta");
    const alfa = screen.getByText("Alfa");
    const mango = screen.getByText("Mango");

    expect(alfa.compareDocumentPosition(mango) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mango.compareDocumentPosition(zeta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("low-stock toggle skips services, which the server never flags as low", () => {
    setResponse([
      buildProduct({ name: "Panela Baja", stock: 2, minStock: 5, isLowStock: true }),
      buildProduct({ name: "Dulce Sano", stock: 9, minStock: 5, isLowStock: false }),
      buildProduct({
        name: "Mantenimiento",
        type: "SERVICE",
        stock: 0,
        minStock: 5,
        isLowStock: false,
      }),
    ]);

    render(<InventoryPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /^Stock bajo( ?\d+)?$/ }),
    );

    expect(screen.getByText("Panela Baja")).toBeInTheDocument();
    expect(screen.queryByText("Dulce Sano")).not.toBeInTheDocument();
    // A service is never low on stock: its numbers would qualify
    // (stock 0 <= minStock 5), so the client-side filter must skip it
    // explicitly instead of comparing raw numbers.
    expect(screen.queryByText("Mantenimiento")).not.toBeInTheDocument();
  });

  it("low-stock toggle skips untracked products, which the server never flags as low", () => {
    setResponse([
      buildProduct({ name: "Panela Baja", stock: 2, minStock: 5, isLowStock: true }),
      buildProduct({ name: "Dulce Sano", stock: 9, minStock: 5, isLowStock: false }),
      buildProduct({
        name: "Servilletas sin conteo",
        type: "PRODUCT",
        stock: 0,
        minStock: 5,
        tracksStock: false,
        isLowStock: false,
      }),
    ]);

    render(<InventoryPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /^Stock bajo( ?\d+)?$/ }),
    );

    expect(screen.getByText("Panela Baja")).toBeInTheDocument();
    expect(screen.queryByText("Dulce Sano")).not.toBeInTheDocument();
    // An untracked product is not counted: its numbers would qualify
    // (stock 0 <= minStock 5), but the server's flag is false, and the page reads
    // the flag rather than comparing raw numbers.
    expect(screen.queryByText("Servilletas sin conteo")).not.toBeInTheDocument();
  });

  it("trusts the server flag over the numbers for an untracked product with stale stock", () => {
    // The drift this locks down: stock 2 <= minStock 5 looks low, but nothing counts it,
    // so the page must not badge it and must not count it in the low-stock total.
    setResponse([
      buildProduct({ name: "Papel sin conteo", stock: 2, minStock: 5, tracksStock: false, isLowStock: false }),
      buildProduct({ name: "Panela Baja", stock: 2, minStock: 5, isLowStock: true }),
    ]);

    render(<InventoryPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /^Stock bajo( ?\d+)?$/ }),
    );

    expect(screen.getByText("Panela Baja")).toBeInTheDocument();
    expect(screen.queryByText("Papel sin conteo")).not.toBeInTheDocument();
    // The low-stock badge counts only what the server flagged: 1, not 2.
    expect(
      screen.getByRole("button", { name: /^Stock bajo ?1$/ }),
    ).toBeInTheDocument();
  });

  it("badges the server's low-stock total instead of the rows on this page", () => {
    // The reported defect: page 1 held no low-stock rows, so the badge hid itself
    // (or said 3) while the low-stock list behind the click held 10 products.
    setResponse(
      [
        buildProduct({ name: "Arequipe", stock: 40, minStock: 5 }),
        buildProduct({ name: "Bocadillo", stock: 30, minStock: 5 }),
      ],
      { total: 40, totalPages: 4, lowStockCount: 10 },
    );

    render(<InventoryPage />);

    expect(
      screen.getByRole("button", { name: /^Stock bajo ?10$/ }),
    ).toBeInTheDocument();
  });

  it("keeps the badge in sync with the filtered page total", () => {
    setResponse(
      [
        buildProduct({ name: "Panela Baja", stock: 2, minStock: 5, isLowStock: true }),
        buildProduct({ name: "Dulce Bajo", stock: 1, minStock: 5, isLowStock: true }),
      ],
      { total: 10, totalPages: 1, lowStockCount: 10 },
    );

    render(<InventoryPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /^Stock bajo ?10$/ }),
    );

    expect(
      screen.getByRole("button", { name: /^Stock bajo ?10$/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Inventory page — create action is gated by the role hierarchy", () => {
  it("shows Nuevo producto for ADMIN", () => {
    authState.role = "ADMIN";

    render(<InventoryPage />);

    expect(screen.getByRole("button", { name: /nuevo producto/i })).toBeInTheDocument();
  });

  it("shows Nuevo producto for SUPER_ADMIN", () => {
    authState.role = "SUPER_ADMIN";

    render(<InventoryPage />);

    expect(screen.getByRole("button", { name: /nuevo producto/i })).toBeInTheDocument();
  });

  it("hides Nuevo producto for CASHIER", () => {
    authState.role = "CASHIER";

    render(<InventoryPage />);

    expect(screen.queryByRole("button", { name: /nuevo producto/i })).not.toBeInTheDocument();
  });

});
