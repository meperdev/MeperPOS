import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

/**
 * T22 — the inventory list reads one site.
 *
 * The list has always answered the organization aggregate. When the caller can
 * read more than one site it also offers "Todas las sedes" plus each site, and
 * choosing one scopes the request and labels the stock column, so the units on
 * screen never leave the reader guessing which site they belong to. A
 * single-site organization keeps the screen it had.
 */
const { authState, sitesState } = vi.hoisted(() => ({
  authState: { role: "ADMIN" as string },
  sitesState: { sites: [] as Array<{ id: string; name: string; type: string; isDefault: boolean }> },
}));

const useProductsMock = vi.fn();
let productsResponse: {
  data: { data: Record<string, unknown>[]; meta: Record<string, number> };
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

vi.mock("@/hooks/useLocations", () => ({
  useLocations: () => ({ data: sitesState.sites, isLoading: false }),
}));

vi.mock("@/hooks/useProductStock", () => ({
  productStockQueryKey: (productId: string) => ["product-stock", productId],
  useProductStockBySite: () => ({
    data: [
      {
        locationId: "site-a",
        name: "Sede centro",
        type: "STORE",
        isDefault: true,
        stock: 5,
        reservedStock: 1,
        availableStock: 4,
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAdjustProductStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    data: { data: [{ id: "cat-1", name: "General" }] },
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
  Modal: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: ReactNode;
    title?: string;
  }) => (isOpen ? <section role="dialog">{children}</section> : null),
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

const buildProduct = (overrides: Record<string, unknown> = {}) => ({
  id: `prod-${overrides.name ?? "x"}`,
  name: (overrides.name as string) ?? "Producto",
  sku: "SKU-1",
  barcode: null,
  description: null,
  costPrice: 1000,
  salePrice: 2000,
  stock: 10,
  minStock: 5,
  isLowStock: false,
  imageUrl: null,
  categoryId: "cat-1",
  category: { id: "cat-1", name: "General" },
  active: true,
  tracksStock: true,
  type: "PRODUCT",
  version: 1,
  ...overrides,
});

const setResponse = (products: Record<string, unknown>[]) => {
  productsResponse = {
    data: {
      data: products,
      meta: {
        total: products.length,
        page: 1,
        limit: 10,
        totalPages: 1,
        lowStockCount: 0,
      },
    },
    isLoading: false,
    isFetching: false,
  };
};

const siteSelector = () =>
  screen.queryByRole("combobox", { name: "Todas las sedes" });

describe("Inventory page — site selector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = "ADMIN";
    sitesState.sites = [
      { id: "site-a", name: "Sede centro", type: "STORE", isDefault: true },
      { id: "site-b", name: "Bodega norte", type: "WAREHOUSE", isDefault: false },
    ];
    setResponse([buildProduct({ name: "Panela" })]);
    useProductsMock.mockImplementation(() => productsResponse);
    window.localStorage.setItem("meperpos:view-mode:inventory", "table");
  });

  afterEach(() => {
    cleanup();
    window.localStorage.removeItem("meperpos:view-mode:inventory");
  });

  it("reads the organization aggregate by default and labels it as all sites", () => {
    render(<InventoryPage />);

    expect(useProductsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: undefined }),
    );
    expect(siteSelector()).toHaveValue("");
    expect(
      within(siteSelector() as HTMLElement).getByRole("option", {
        name: "Todas las sedes",
      }),
    ).toBeInTheDocument();
  });

  it("hides the selector for a caller with a single readable site", () => {
    sitesState.sites = [sitesState.sites[0]];
    render(<InventoryPage />);

    expect(siteSelector()).not.toBeInTheDocument();
    expect(useProductsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: undefined }),
    );
  });

  it("scopes the request to the chosen site and labels the stock column with it", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.selectOptions(siteSelector() as HTMLElement, "site-b");

    await waitFor(() =>
      expect(useProductsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ locationId: "site-b" }),
      ),
    );
    const stockHeader = screen.getByRole("columnheader", {
      name: /Existencias/,
    });
    expect(stockHeader).toHaveTextContent("Bodega norte");
  });

  it("returns to the aggregate when all sites are chosen again", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.selectOptions(siteSelector() as HTMLElement, "site-b");
    await user.selectOptions(siteSelector() as HTMLElement, "");

    await waitFor(() =>
      expect(useProductsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ locationId: undefined }),
      ),
    );
  });

  it("shows the per-site breakdown in the editor and pins the aggregate stock field", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);

    const row = screen.getByText("Panela").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Editar Panela" }));

    const dialog = screen.getByRole("dialog");
    const section = within(dialog).getByRole("group", {
      name: "Existencias por sede",
    });
    expect(
      within(section).getByRole("row", { name: /Sede centro/ }),
    ).toHaveTextContent("5 uds.");

    // A multi-site organization adjusts per site, so the absolute field no
    // longer accepts a number.
    const stockField = within(dialog).getByLabelText(/^Stock\*?$/);
    expect(stockField).toBeDisabled();
    for (const name of ["Aumentar Stock", "Disminuir Stock"]) {
      expect(within(dialog).getByRole("button", { name })).toBeDisabled();
    }
    expect(dialog).toHaveTextContent(
      "Ajusta las existencias por sede en la sección «Existencias por sede».",
    );
  });

  it("keeps the absolute stock field editable for a single-site organization", async () => {
    sitesState.sites = [sitesState.sites[0]];
    const user = userEvent.setup();
    render(<InventoryPage />);

    const row = screen.getByText("Panela").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Editar Panela" }));

    const dialog = screen.getByRole("dialog");
    const stockField = within(dialog).getByLabelText(/^Stock\*?$/);
    expect(stockField).not.toHaveAttribute("readonly");
    expect(dialog).not.toHaveTextContent("Ajusta las existencias por sede");
  });
});
