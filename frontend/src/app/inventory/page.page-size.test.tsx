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

/**
 * jsdom ships no `matchMedia`. The inventory grid widens its track from `lg` in CSS,
 * and the page mirrors that width into the hook, so this stub answers that one query.
 */
function stubMatchMedia(isWide: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: isWide && query === "(min-width: 1024px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
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
  Reflect.deleteProperty(window, "matchMedia");
});

describe("Inventory page — page size follows the viewport (card view)", () => {
  it("requests the size the grid computed instead of the fixed default", () => {
    render(<InventoryPage />);

    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, limit: 36 }));
    // The hook receives the product track and the range the endpoint accepts.
    expect(lastPageSizeOptions()).toEqual(
      expect.objectContaining({ minCardWidth: 160, gap: 16, min: 10, max: 100 }),
    );
    // Inventory stretches its rows, so the row count must come from the minimum row
    // height: a stretched card is taller than that and would shrink the page.
    expect(lastPageSizeOptions()).toEqual(
      expect.objectContaining({ measureRowHeight: false }),
    );
  });

  it("uses the wider 200px inventory track from lg, where the grid CSS widens it", () => {
    stubMatchMedia(true);

    render(<InventoryPage />);

    expect(lastPageSizeOptions()).toEqual(
      expect.objectContaining({ minCardWidth: 200 }),
    );
  });

  it("keeps the shared 160px track below lg, so a phone still holds two cards", () => {
    stubMatchMedia(false);

    render(<InventoryPage />);

    expect(lastPageSizeOptions()).toEqual(
      expect.objectContaining({ minCardWidth: 160 }),
    );
  });

  it("asks for exactly the cards that fit from lg, where rows stretch under the pager", () => {
    // 1366x768 fits four columns and two rows: asking for the ten-card floor would
    // add a third row that scrolls under the pinned pager.
    stubMatchMedia(true);
    settleGridSize(10, 4, 2);

    render(<InventoryPage />);

    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, limit: 8 }));
  });

  it("keeps the ten-card floor below lg, so a phone keeps the list it always had", () => {
    stubMatchMedia(false);
    settleGridSize(10, 2, 2);

    render(<InventoryPage />);

    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, limit: 10 }));
  });

  it("gives the grid exactly one row track per measured row from lg", () => {
    // CSS auto-fill would fit its own number of tracks, which can differ from the rows
    // the page requested: at 1590x913 that left the first row 335px and the second
    // 216px. The tracks come from the hook's row count instead.
    stubMatchMedia(true);
    settleGridSize(10, 5, 2);

    render(<InventoryPage />);

    const grid = document.querySelector("[aria-busy]") as HTMLElement;
    expect(grid.style.gridTemplateRows).toBe("repeat(2, minmax(216px, 1fr))");
  });

  it("keeps every row track on a short last page, so its cards are not taller", () => {
    // Only two products render here, far fewer than the five columns: the tracks must
    // still be the two the full page uses, or the lone row would grow to the whole grid.
    stubMatchMedia(true);
    settleGridSize(10, 5, 2);

    render(<InventoryPage />);

    const grid = document.querySelector("[aria-busy]") as HTMLElement;
    expect(grid.children).toHaveLength(2);
    expect(grid.style.gridTemplateRows).toBe("repeat(2, minmax(216px, 1fr))");
  });

  it("leaves the row tracks to the cards below lg", () => {
    // Below lg the grid is a normal auto-row grid of poster cards: no inline tracks.
    stubMatchMedia(false);
    settleGridSize(10, 2, 2);

    render(<InventoryPage />);

    const grid = document.querySelector("[aria-busy]") as HTMLElement;
    expect(grid.style.gridTemplateRows).toBe("");
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
