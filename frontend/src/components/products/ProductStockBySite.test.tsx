import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProductSiteStock } from "@/hooks/useProductStock";

/**
 * T22 — the "Existencias por sede" section of the product editor.
 *
 * The table is the inventory read the aggregate cannot give: every readable
 * site, with its own units, its reservations and what can still leave. The
 * adjustment action belongs to the roles that may edit stock; a read-only
 * visitor still sees the numbers.
 */
const { state, adjustMutateAsync, toastSuccess, toastError, authState } =
  vi.hoisted(() => ({
    state: {
      sites: [] as ProductSiteStock[],
      loading: false,
      failed: false,
      pending: false,
    },
    adjustMutateAsync: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    authState: { role: "ADMIN" as string },
  }));

vi.mock("@/hooks/useProductStock", () => ({
  productStockQueryKey: (productId: string) => ["product-stock", productId],
  useProductStockBySite: () => ({
    data: state.sites,
    isLoading: state.loading,
    isError: state.failed,
    refetch: vi.fn(),
  }),
  useAdjustProductStock: () => ({
    mutateAsync: adjustMutateAsync,
    isPending: state.pending,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-1", role: authState.role } }),
}));

import { ProductStockBySite } from "./ProductStockBySite";

const principal: ProductSiteStock = {
  locationId: "site-a",
  name: "Sede centro",
  type: "STORE",
  isDefault: true,
  stock: 5,
  reservedStock: 1,
  availableStock: 4,
};
const warehouse: ProductSiteStock = {
  locationId: "site-b",
  name: "Bodega norte",
  type: "WAREHOUSE",
  isDefault: false,
  stock: 0,
  reservedStock: 0,
  availableStock: 0,
};

const section = () =>
  screen.getByRole("group", { name: "Existencias por sede" });

describe("ProductStockBySite", () => {
  beforeEach(() => {
    state.sites = [principal, warehouse];
    state.loading = false;
    state.failed = false;
    state.pending = false;
    authState.role = "ADMIN";
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("lists every readable site with its own units, reservations and availability", () => {
    render(<ProductStockBySite productId="p-1" />);

    const rows = within(section()).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + two sites
    const principalRow = within(section()).getByRole("row", {
      name: /Sede centro/,
    });
    expect(principalRow).toHaveTextContent("5 uds.");
    expect(principalRow).toHaveTextContent("4");
    const warehouseRow = within(section()).getByRole("row", {
      name: /Bodega norte/,
    });
    expect(warehouseRow).toHaveTextContent("0 uds.");
  });

  it("marks the principal site and names a warehouse as one", () => {
    render(<ProductStockBySite productId="p-1" />);

    expect(
      within(section()).getByRole("row", { name: /Sede centro/ }),
    ).toHaveTextContent("Principal");
    expect(
      within(section()).getByRole("row", { name: /Bodega norte/ }),
    ).toHaveTextContent("Bodega");
  });

  it("offers the adjustment to the roles that edit stock and hides it from the rest", () => {
    const { unmount } = render(<ProductStockBySite productId="p-1" />);
    expect(
      within(section()).getByRole("button", { name: "Ajustar existencias" }),
    ).toBeInTheDocument();
    unmount();

    authState.role = "CASHIER";
    render(<ProductStockBySite productId="p-1" />);
    expect(
      within(section()).queryByRole("button", { name: "Ajustar existencias" }),
    ).not.toBeInTheDocument();
  });

  it("opens the adjustment dialog on the selected product", async () => {
    const user = userEvent.setup();
    render(<ProductStockBySite productId="p-1" />);

    await user.click(
      within(section()).getByRole("button", { name: "Ajustar existencias" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Ajustar existencias" }),
    ).toBeInTheDocument();
    // The default site is the one an operator most often corrects.
    expect(
      within(dialog).getByRole("button", { name: "Sede" }),
    ).toHaveTextContent("Sede centro");
  });

  it("says loading, failure and empty instead of pretending the sites hold nothing", async () => {
    state.loading = true;
    const { unmount } = render(<ProductStockBySite productId="p-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cargando existencias…",
    );
    unmount();

    state.loading = false;
    state.failed = true;
    const failed = render(<ProductStockBySite productId="p-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las existencias.",
    );
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    failed.unmount();

    state.failed = false;
    state.sites = [];
    render(<ProductStockBySite productId="p-1" />);
    expect(
      screen.getByText("No tienes sedes asignadas."),
    ).toBeInTheDocument();
  });
});
