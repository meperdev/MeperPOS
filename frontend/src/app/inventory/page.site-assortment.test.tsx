import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

/**
 * T25 — a chosen site opens on the products that site carries.
 *
 * The inventory list reads the organization aggregate until the caller picks a
 * site; from then on it asks for that site's assortment, so the list is not the
 * whole catalog with borrowed numbers. "Todo el catálogo" reveals the products
 * the site does not carry yet, so they can be stocked from here, and a site
 * with nothing at all says so instead of showing an empty catalog.
 */
const { authState, sitesState } = vi.hoisted(() => ({
  authState: { role: "ADMIN" as string },
  sitesState: {
    sites: [] as Array<{
      id: string;
      name: string;
      type: string;
      isDefault: boolean;
    }>,
  },
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
    data: [],
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
    user: {
      id: "admin-1",
      role: authState.role,
      name: "Admin",
      email: "a@b.co",
    },
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
    isOpen ? <section role="dialog">{children}</section> : null,
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
      onChange={(event) => onChange?.(event.target.value)}
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
      onChange={(event) => onChange?.(event.target.value)}
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
const carriedSwitch = () =>
  screen.queryByRole("button", { name: "Solo de esta sede" });
const catalogSwitch = () =>
  screen.queryByRole("button", { name: "Todo el catálogo" });

const lastRequest = () => {
  const calls = useProductsMock.mock.calls;
  return calls[calls.length - 1]?.[0] as
    | { locationId?: string; carriedAtSite?: boolean }
    | undefined;
};

describe("Inventory page — site assortment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = "ADMIN";
    sitesState.sites = [
      { id: "site-a", name: "Sede centro", type: "STORE", isDefault: true },
      {
        id: "site-b",
        name: "Bodega norte",
        type: "WAREHOUSE",
        isDefault: false,
      },
    ];
    setResponse([buildProduct({ name: "Panela" })]);
    useProductsMock.mockImplementation(() => productsResponse);
    window.localStorage.setItem("meperpos:view-mode:inventory", "table");
  });

  afterEach(() => {
    cleanup();
    window.localStorage.removeItem("meperpos:view-mode:inventory");
  });

  it("keeps the organization view, with no assortment switch, until a site is chosen", () => {
    render(<InventoryPage />);

    expect(lastRequest()).toMatchObject({
      locationId: undefined,
      carriedAtSite: undefined,
    });
    expect(carriedSwitch()).not.toBeInTheDocument();
    expect(catalogSwitch()).not.toBeInTheDocument();
  });

  it("opens a chosen site on that site's own assortment", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.selectOptions(siteSelector() as HTMLElement, "site-b");

    await waitFor(() =>
      expect(lastRequest()).toMatchObject({
        locationId: "site-b",
        carriedAtSite: true,
      }),
    );
    expect(carriedSwitch()).toHaveAttribute("aria-pressed", "true");
    expect(catalogSwitch()).toHaveAttribute("aria-pressed", "false");
  });

  it("reveals the whole catalog on request and returns to the assortment", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.selectOptions(siteSelector() as HTMLElement, "site-b");
    await user.click(catalogSwitch() as HTMLElement);

    await waitFor(() =>
      expect(lastRequest()).toMatchObject({
        locationId: "site-b",
        carriedAtSite: false,
      }),
    );
    expect(catalogSwitch()).toHaveAttribute("aria-pressed", "true");

    await user.click(carriedSwitch() as HTMLElement);

    await waitFor(() =>
      expect(lastRequest()).toMatchObject({
        locationId: "site-b",
        carriedAtSite: true,
      }),
    );
  });

  it("opens the next site on its own assortment again", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.selectOptions(siteSelector() as HTMLElement, "site-b");
    await user.click(catalogSwitch() as HTMLElement);
    await user.selectOptions(siteSelector() as HTMLElement, "site-a");

    await waitFor(() =>
      expect(lastRequest()).toMatchObject({
        locationId: "site-a",
        carriedAtSite: true,
      }),
    );
  });

  it("says a site has no products yet and where they can come from", async () => {
    setResponse([]);
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.selectOptions(siteSelector() as HTMLElement, "site-b");

    expect(
      screen.getByText("Esta sede aún no tiene productos"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/transfiere unidades, recibe una compra o ajusta existencias/i),
    ).toHaveTextContent("«Todo el catálogo»");
    // The way out is on screen: the switch that reveals the whole catalog.
    expect(catalogSwitch()).toBeInTheDocument();
  });

  it("keeps the generic empty state for the catalog and for all sites", async () => {
    setResponse([]);
    const user = userEvent.setup();
    render(<InventoryPage />);

    // All sites: the screen has never had products.
    expect(screen.getByText("No hay productos aún")).toBeInTheDocument();
    expect(
      screen.queryByText("Esta sede aún no tiene productos"),
    ).not.toBeInTheDocument();

    await user.selectOptions(siteSelector() as HTMLElement, "site-b");
    await user.click(catalogSwitch() as HTMLElement);

    await waitFor(() =>
      expect(
        screen.queryByText("Esta sede aún no tiene productos"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("No hay productos aún")).toBeInTheDocument();
  });
});
