import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { Product, Sale } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

type UseProductsParams = {
  page?: number;
  limit?: number;
  search?: string;
  type?: "PRODUCT" | "SERVICE";
  ids?: string[];
  available?: boolean;
};

const useProductsMock = vi.fn();
const quickSearchMutateMock = vi.fn();
const createSaleMutateMock = vi.fn();
const createPosLoanMutateMock = vi.fn();
const resumeSaleMock = vi.fn();
const apiGetMock = vi.fn();
const pausedSalesState = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => (
    <span role="img" aria-label={props.alt ?? "image"} />
  ),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  // Model the real layout's loading gate: POSPage stays mounted and runs its
  // effects, but its grid DOM mounts only after the shared auth signal clears.
  // Navigation, sidebar and authorization are outside this geometry regression.
  DashboardLayout: function DeferredDashboardLayout({ children }: { children: ReactNode }) {
    const { loading } = useAuth();
    return loading ? null : <>{children}</>;
  },
}));

vi.mock("@/components/products/ProductCard", () => ({
  ProductCard: ({ product, onClick, onToggleFavorite }: { product: Product; onClick: () => void; onToggleFavorite?: () => void }) => (
    <div>
      <button type="button" onClick={onClick}>{product.name}</button>
      <button type="button" aria-label={`Favorito ${product.id}`} onClick={onToggleFavorite}>★</button>
    </div>
  ),
}));

vi.mock("@/components/pos/PaymentMethodCards", () => ({
  PaymentMethodCards: ({
    onMethodChange,
  }: {
    onMethodChange: (method: "CASH" | "CARD" | "TRANSFER") => void;
  }) => (
    <div>
      <button type="button" onClick={() => onMethodChange("CASH")}>
        Efectivo
      </button>
      <button type="button" onClick={() => onMethodChange("CARD")}>
        Tarjeta
      </button>
      <button type="button" onClick={() => onMethodChange("TRANSFER")}>
        Transferencia
      </button>
    </div>
  ),
}));

vi.mock("@/components/pos/PaymentConfirmationModal", () => ({
  PaymentConfirmationModal: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => Promise<void>;
  }) =>
    isOpen ? (
      <button type="button" onClick={() => void onConfirm()}>
        Confirmar pago
      </button>
    ) : null,
}));

// S1 code splitting: heavy modals load through next/dynamic. The mock keeps a
// deterministic fallback window (one macrotask) so tests can observe the
// DynamicFallback skeleton before the chunk resolves; __resetDynamicChunks
// keeps tests independent of each other's cached chunks.
vi.mock("next/dynamic", () => {
  type ChunkState = { resolved: ComponentType<Record<string, unknown>> | null };
  const chunks: ChunkState[] = [];

  return {
    default: (
      loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>,
      options?: { loading?: () => ReactNode },
    ) => {
      const state: ChunkState = { resolved: null };
      chunks.push(state);

      function DynamicChunk(props: Record<string, unknown>) {
        const [, setLoaded] = useState(false);

        useEffect(() => {
          // 50ms window: outlives userEvent's internal setTimeout(0) waits so
          // the fallback is observable synchronously after the click, while
          // findByRole still resolves the chunk quickly.
          const timer = setTimeout(
            () => {
              void loader().then((mod) => {
                state.resolved = mod.default;
                setLoaded(true);
              });
            },
            50,
          );
          return () => clearTimeout(timer);
        }, [loader]);

        if (state.resolved) {
          const Loaded = state.resolved;
          return <Loaded {...props} />;
        }

        return <>{options?.loading ? options.loading() : null}</>;
      }

      return DynamicChunk;
    },
    __resetDynamicChunks: () => {
      for (const chunk of chunks) chunk.resolved = null;
    },
  };
});

vi.mock("@/components/ui/Input", () => {
  const MockInput = forwardRef<
    HTMLInputElement,
    {
      value?: string;
      onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
      onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
      placeholder?: string;
      disabled?: boolean;
    }
  >(function MockInput({ value, onChange, onKeyDown, placeholder, disabled }, ref) {
    return (
      <input
        ref={ref}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  });

  return { Input: MockInput };
});

vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, onClick, disabled, type, "aria-pressed": pressed }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/Badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children: ReactNode;
  }) => (isOpen ? <section aria-label={title}>{children}</section> : null),
}));

// ConfirmDialog is the shared warning dialog. The mock mirrors its documented
// contract — isOpen gate, title, message, confirmText/cancelText, onClose wired
// to both the cancel button and the backdrop, and the same close-after-confirm
// semantics (await onConfirm, then onClose) — so POS tests can drive the
// confirmation and observe exactly which words reach the cashier.
vi.mock("@/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = "Confirmar",
    cancelText = "Cancelar",
  }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <p data-testid="confirm-message">{message}</p>
        <div data-testid="confirm-backdrop" onClick={onClose} />
        <button type="button" onClick={onClose}>
          {cancelText}
        </button>
        <button
          type="button"
          onClick={() => {
            void Promise.resolve(onConfirm()).then(onClose);
          }}
        >
          {confirmText}
        </button>
      </div>
    ) : null,
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: (params?: UseProductsParams) => useProductsMock(params),
  useQuickSearchProduct: () => ({
    mutateAsync: quickSearchMutateMock,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({
    data: {
      data: [
        {
          id: "customer-1",
          name: "Ana Perez",
          documentType: "CC",
          documentNumber: "123",
          email: null,
          phone: null,
          address: null,
          segment: "OCCASIONAL",
          active: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  }),
}));

vi.mock("@/hooks/useSales", () => ({
  useCreateSale: () => ({
    mutateAsync: createSaleMutateMock,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useLoans", () => ({
  useCreatePosLoan: () => ({
    mutateAsync: createPosLoanMutateMock,
    isPending: false,
  }),
}));

vi.mock("@/hooks/usePausedSales", () => ({
  usePausedSales: () => ({
    pausedSales: pausedSalesState.list,
    pauseSale: vi.fn(),
    resumeSale: resumeSaleMock,
    deletePausedSale: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => apiGetMock(...args) },
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("@/hooks/useReceipt", () => ({
  printReceipt: vi.fn(),
  printThermalReceipt: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    data: {
      organization: { name: "Mi Tienda", logoUrl: "https://res.cloudinary.com/demo/image/upload/logos/store.png" },
      invoicing: { printHeader: null, printFooter: null },
      receipt: { prefix: "REC" },
      locale: { currency: "COP", locale: "es-CO", timezone: "America/Bogota" },
      custom: {},
    },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

// The POS reads the acting role to decide whether to offer the price-override
// control. Default to CASHIER; permission tests select other roles explicitly.
const authState = vi.hoisted(() => ({ role: "CASHIER" as string, loading: false }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: authState.role ? { role: authState.role } : null, loading: authState.loading }),
}));

import POSPage from "./page";
import { printReceipt, printThermalReceipt } from "@/hooks/useReceipt";
import * as nextDynamic from "next/dynamic";

const resetDynamicChunks = () =>
  (nextDynamic as unknown as { __resetDynamicChunks?: () => void })
    .__resetDynamicChunks?.();

function makeProduct(
  id: string,
  name: string,
  overrides: Partial<Product> = {},
): Product {
  return {
    id,
    name,
    sku: `sku-${id}`,
    barcode: null,
    description: null,
    costPrice: 1000,
    salePrice: 1000,
    taxRate: 0,
    stock: 10,
    minStock: 1,
    imageUrl: null,
    categoryId: "cat-1",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makeSale(): Sale {
  return {
    id: "sale-1",
    saleNumber: 101,
    customerId: null,
    subtotal: 1000,
    taxAmount: 0,
    discountAmount: 0,
    total: 1000,
    amountPaid: 1000,
    change: 0,
    status: "COMPLETED",
    userId: "user-1",
    items: [],
    payments: [{ id: "pay-1", saleId: "sale-1", method: "CARD", amount: 1000, createdAt: "2026-01-01T00:00:00.000Z" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("products query service filter", () => {
  afterEach(cleanup);

  it("isolates IDs/availability cache and placeholders, including explicit empty IDs", async () => {
    apiGetMock.mockReset();
    const { useProducts } = await vi.importActual<typeof import("@/hooks/useProducts")>("@/hooks/useProducts");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const previous = { data: [makeProduct("p1", "Catalogo")], meta: { total: 80, totalPages: 4 } };
    apiGetMock.mockResolvedValueOnce({ data: previous }).mockImplementation(() => new Promise(() => {}));
    const { result, rerender, unmount } = renderHook((params: { ids?: string[]; available?: boolean }) => useProducts({ page: 1, limit: 3, ...params }), { wrapper, initialProps: {} });
    await waitFor(() => expect(result.current.data).toEqual(previous));
    rerender({ ids: [] });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(apiGetMock).toHaveBeenLastCalledWith("/products", { page: 1, limit: 3, ids: "" }));
    rerender({ ids: ["b", "a", "b"], available: true });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(apiGetMock).toHaveBeenLastCalledWith("/products", { page: 1, limit: 3, ids: "a,b", available: true }));
    expect(client.getQueryCache().findAll({ queryKey: ["products"] })).toHaveLength(3);
    unmount();
    client.clear();
    apiGetMock.mockReset();
  });

  it("forwards type in the request and isolates cache/placeholder data across types", async () => {
    const { useProducts } = await vi.importActual<typeof import("@/hooks/useProducts")>("@/hooks/useProducts");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const previous = { data: [makeProduct("p1", "Mercancia")], meta: { total: 80, totalPages: 4 } };
    apiGetMock.mockResolvedValueOnce({ data: previous }).mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender, unmount } = renderHook(({ type }: { type?: "SERVICE" }) => useProducts({ page: 1, limit: 6, type }), { wrapper, initialProps: { type: undefined } as { type?: "SERVICE" } });
    await waitFor(() => expect(result.current.data).toEqual(previous));
    rerender({ type: "SERVICE" });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(apiGetMock).toHaveBeenLastCalledWith("/products", { page: 1, limit: 6, type: "SERVICE" }));
    expect(client.getQueryCache().findAll({ queryKey: ["products"] }).map((query) => query.queryKey)).toEqual([
      ["products", { page: 1, limit: 6, type: undefined }],
      ["products", { page: 1, limit: 6, type: "SERVICE" }],
    ]);
    unmount();
    client.clear();
  });
});

describe("POS capacity attachment across auth readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    authState.loading = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])("measures mounted rows, resizes and cleans up (initial auth loading: %s)", async (initialLoading) => {
    authState.loading = initialLoading;
    let height = 552;
    const observers: Array<{ resize: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(readonly resize: () => void) { observers.push(this); }
    });
    const getStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      if ((element as HTMLElement).dataset.testid === "pos-capacity-area") return { paddingTop: "16px", paddingBottom: "16px" } as CSSStyleDeclaration;
      if (element.parentElement?.dataset.testid === "pos-capacity-area") return { gridTemplateColumns: "192px 192px 192px", gridAutoRows: "248px", columnGap: "12px", rowGap: "12px" } as CSSStyleDeclaration;
      return getStyle(element);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.testid === "pos-capacity-area" ? height : 0; });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.parentElement?.dataset.testid === "pos-capacity-area" ? 600 : 0; });
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const list = Array.from({ length: 24 }, (_, i) => makeProduct(`p${i}`, `Measured product ${i}`));
    useProductsMock.mockImplementation((params: UseProductsParams) => ({
      data: { data: list.slice((params.page! - 1) * params.limit!, params.page! * params.limit!), meta: { total: list.length, totalPages: Math.ceil(list.length / params.limit!) } },
      isLoading: false, isFetching: false,
    }));
    const { rerender, unmount } = render(<POSPage />);
    if (initialLoading) {
      expect(screen.queryByTestId("pos-capacity-area")).toBeNull();
      expect(observers).toHaveLength(0);
      expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 1 }));
      authState.loading = false;
      rerender(<POSPage />); // Same POS instance, not route reentry.
    }
    expect(screen.getByTestId("pos-capacity-area")).toBeTruthy();
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 6, page: 1 }));
    expect(screen.getAllByRole("button", { name: /^Measured product/ })).toHaveLength(6);
    expect(screen.getByText("1 / 4")).toBeTruthy();
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledExactlyOnceWith(screen.getByTestId("pos-capacity-area"));
    rerender(<POSPage />);
    expect(observers).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(screen.getByText("2 / 4")).toBeTruthy();
    height = 300;
    act(() => observers[0].resize());
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 3, page: 1 }));
    expect(screen.getAllByRole("button", { name: /^Measured product/ })).toHaveLength(3);
    expect(screen.getByText("1 / 8")).toBeTruthy();
    authState.loading = true;
    rerender(<POSPage />);
    expect(screen.queryByTestId("pos-capacity-area")).toBeNull();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    authState.loading = false;
    rerender(<POSPage />);
    expect(observers).toHaveLength(2);
    expect(observers[1].observe).toHaveBeenCalledExactlyOnceWith(screen.getByTestId("pos-capacity-area"));
    height = 552;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(screen.getAllByRole("button", { name: /^Measured product/ })).toHaveLength(6);
    expect(screen.getByText("1 / 4")).toBeTruthy();
    unmount();
    for (const observer of observers) {
      expect(observer.disconnect).toHaveBeenCalledOnce();
      expect(addListener).toHaveBeenCalledWith("resize", observer.resize);
      expect(removeListener).toHaveBeenCalledWith("resize", observer.resize);
    }
    const calls = useProductsMock.mock.calls.length;
    act(() => {
      observers.forEach((observer) => observer.resize());
      window.dispatchEvent(new Event("resize"));
    });
    expect(useProductsMock).toHaveBeenCalledTimes(calls);
  });
});

describe("POS behavior evidence (#19, #18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDynamicChunks();
    createSaleMutateMock.mockResolvedValue(makeSale());
  });

  afterEach(() => {
    cleanup();
  });

  it("reaches saved favorites beyond the first adaptive page with a multi-page pager", async () => {
    const list = Array.from({ length: 25 }, (_, i) => makeProduct(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `Favorito ${i}`));
    const ids = list.slice(10).map((p) => p.id);
    localStorage.setItem("pos_favorite_product_ids", JSON.stringify([...ids, ids[0], null, {}, "bad"]));
    useProductsMock.mockImplementation((params: UseProductsParams) => {
      const filtered = params.ids === undefined ? list : list.filter((p) => params.ids!.includes(p.id));
      const limit = params.limit!;
      return { data: { data: filtered.slice((params.page! - 1) * limit, params.page! * limit), meta: { total: filtered.length, totalPages: Math.ceil(filtered.length / limit) } }, isLoading: false, isFetching: false };
    });
    render(<POSPage />);
    await userEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ ids, available: true }));
    expect(screen.getByText("Favorito 10")).toBeTruthy();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeTruthy();
    for (let page = 0; page < 15 && !screen.queryByText("Favorito 24"); page++) {
      await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    }
    expect(screen.getByText("Favorito 24")).toBeTruthy();
    localStorage.removeItem("pos_favorite_product_ids");
  });

  it("intersects favorite services/search and clamps after removing the last page's favorite", async () => {
    const ids = [1, 2].map((i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    localStorage.setItem("pos_favorite_product_ids", JSON.stringify(ids));
    const list = ids.map((id, i) => makeProduct(id, `Repair ${i}`, { type: "SERVICE", stock: 0 }));
    useProductsMock.mockImplementation((params: UseProductsParams) => {
      const filtered = list.filter((p) => (params.ids === undefined || params.ids.includes(p.id)) && (!params.type || p.type === params.type) && (!params.search || p.name.toLowerCase().includes(params.search.toLowerCase())));
      return { data: { data: filtered.slice((params.page! - 1) * params.limit!, params.page! * params.limit!), meta: { total: filtered.length, totalPages: Math.ceil(filtered.length / params.limit!) } }, isLoading: false, isFetching: false };
    });
    render(<POSPage />);
    await userEvent.click(screen.getByRole("button", { name: "Todos" }));
    await userEvent.click(screen.getByRole("button", { name: "Servicios" }));
    await userEvent.type(screen.getByPlaceholderText("Escanear o buscar por nombre, SKU o código..."), "repair");
    await waitFor(() => expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: "repair", type: "SERVICE", ids, available: true })));
    await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(screen.getByText("Repair 1")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: `Favorito ${ids[1]}` }));
    await waitFor(() => expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, ids: [ids[0]] })));
    expect(screen.getByText("Repair 0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /siguiente/i })).toBeNull();
    localStorage.removeItem("pos_favorite_product_ids");
  });

  it("sends empty favorites as an explicit restrictive IDs filter", async () => {
    localStorage.setItem("pos_favorite_product_ids", JSON.stringify([null, {}, "bad"]));
    useProductsMock.mockImplementation((params: UseProductsParams) => ({ data: { data: params.ids === undefined ? [makeProduct("p1", "Catalogo")] : [], meta: { total: params.ids === undefined ? 1 : 0, totalPages: 1 } }, isLoading: false, isFetching: false }));
    render(<POSPage />);
    await userEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ ids: [], available: true }));
    expect(screen.queryByText("Catalogo")).toBeNull();
    localStorage.removeItem("pos_favorite_product_ids");
  });

  it.each(["pending", "error", "empty"])("keeps repeated Services toggles available during %s while preserving search/favorites", async (state) => {
    const ids = ["00000000-0000-4000-8000-000000000001"];
    localStorage.setItem("pos_favorite_product_ids", JSON.stringify(ids));
    const refetch = vi.fn();
    useProductsMock.mockImplementation((params: UseProductsParams) => {
      const serviceOnly = params.type === "SERVICE";
      return {
        data: serviceOnly && state !== "empty" ? undefined : {
          data: serviceOnly ? [] : [makeProduct(ids[0], "Repair product")],
          meta: { total: serviceOnly ? 0 : 3, totalPages: serviceOnly ? 1 : 3 },
        },
        isLoading: serviceOnly && state === "pending",
        isFetching: serviceOnly && state === "pending",
        isError: serviceOnly && state === "error",
        error: new Error("Query failed"),
        refetch,
      };
    });
    render(<POSPage />);
    await userEvent.click(screen.getByRole("button", { name: "Todos" }));
    const search = screen.getByPlaceholderText("Escanear o buscar por nombre, SKU o código...");
    await userEvent.type(search, "repair");
    await waitFor(() => expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: "repair" })));
    for (let cycle = 0; cycle < 2; cycle++) {
      await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
      expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
      await userEvent.click(screen.getByRole("button", { name: "Servicios" }));
      expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, type: "SERVICE", search: "repair", ids }));
      expect(screen.getByRole("button", { name: "Servicios" })).not.toBeDisabled();
      if (state === "pending") expect(screen.getByText("Buscando productos...")).toBeTruthy();
      if (state === "empty") expect(screen.getByText("No tienes favoritos")).toBeTruthy();
      if (state === "error") {
        expect(screen.queryByText("No tienes favoritos")).toBeNull();
        expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los productos.");
        await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
        expect(refetch).toHaveBeenCalledTimes(cycle + 1);
      }
      await userEvent.click(screen.getByRole("button", { name: "Servicios" }));
      expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, type: undefined, search: "repair", ids }));
      expect(search).toHaveValue("repair");
      expect(screen.getByRole("button", { name: "Favoritos" })).toBeTruthy();
      expect(screen.getByText("Repair product")).toBeTruthy();
    }
    localStorage.removeItem("pos_favorite_product_ids");
  });

  it("retries a failed page without advertising cached products or resetting filters/page", async () => {
    let failed = false;
    const refetch = vi.fn();
    useProductsMock.mockImplementation(() => ({
      data: { data: [makeProduct("p1", "Cached product")], meta: { total: 3, totalPages: 3 } },
      isLoading: false, isFetching: false, isError: failed, refetch,
    }));
    const { rerender } = render(<POSPage />);
    await userEvent.click(screen.getByRole("button", { name: "Servicios" }));
    await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    failed = true;
    rerender(<POSPage />);
    expect(screen.queryByText("Cached product")).toBeNull();
    expect(screen.queryByText("No hay productos disponibles")).toBeNull();
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, type: "SERVICE" }));
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledOnce();
    failed = false;
    rerender(<POSPage />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Cached product")).toBeTruthy();
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, type: "SERVICE" }));
  });

  it("exposes the Services selection as a pressed toggle", async () => {
    useProductsMock.mockReturnValue({ data: { data: [], meta: { total: 0, totalPages: 1 } }, isLoading: false });
    render(<POSPage />);
    const toggle = screen.getByRole("button", { name: "Servicios" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("caps the rendered grid tracks using a responsive minimum rather than fixed five columns", () => {
    useProductsMock.mockReturnValue({ data: { data: [], meta: { total: 0, totalPages: 1 } }, isLoading: false });
    render(<POSPage />);
    const grid = screen.getByTestId("pos-capacity-area").firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(min(100%, max(176px, calc((100% - 48px) / 5))), 1fr))");
  });

  it("pages the complete server-filtered service fixture, not the merchandise page", async () => {
    const merchandise = Array.from({ length: 20 }, (_, i) => makeProduct(`p${i}`, `Mercancia ${i}`));
    const services = Array.from({ length: 7 }, (_, i) => ({ ...makeProduct(`s${i}`, `Servicio ${i}`), type: "SERVICE" as const, stock: 0 }));
    useProductsMock.mockImplementation((params: UseProductsParams) => {
      const list = params.type === "SERVICE" ? services : [...merchandise, ...services];
      const limit = params.limit ?? 20;
      const page = params.page ?? 1;
      return { data: { data: list.slice((page - 1) * limit, page * limit), meta: { total: list.length, totalPages: Math.ceil(list.length / limit) } }, isLoading: false, isFetching: false };
    });
    render(<POSPage />);
    await userEvent.click(screen.getByRole("button", { name: "Servicios" }));
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: "SERVICE", page: 1 }));
    expect(screen.getByText("Servicio 0")).toBeTruthy();
    expect(screen.getByText("7", { selector: "span" })).toBeTruthy();
    while (!screen.queryByText("Servicio 6")) {
      await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    }
    await userEvent.click(screen.getByRole("button", { name: "Servicios" }));
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: undefined, page: 1 }));
  });

  it("resets on measured capacity change, keeps the pager outside it, and cleans up", async () => {
    let resize = () => {};
    let height = 552;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const getStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      if ((element as HTMLElement).dataset.testid === "pos-capacity-area") return { paddingTop: "16px", paddingBottom: "16px" } as CSSStyleDeclaration;
      if (element.parentElement?.dataset.testid === "pos-capacity-area") return { gridTemplateColumns: "192px 192px 192px", gridAutoRows: "248px", columnGap: "12px", rowGap: "12px" } as CSSStyleDeclaration;
      return getStyle(element);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.testid === "pos-capacity-area" ? height : 0; });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.parentElement?.dataset.testid === "pos-capacity-area" ? 600 : 0; });
    useProductsMock.mockImplementation((params: UseProductsParams) => ({
      data: { data: [makeProduct("p1", "Producto")], meta: { total: 24, totalPages: Math.ceil(24 / params.limit!) } }, isLoading: false, isFetching: false,
    }));
    const { unmount } = render(<POSPage />);
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 6, page: 1 }));
    await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    const area = screen.getByTestId("pos-capacity-area");
    expect(area.contains(screen.getByTestId("pos-pager"))).toBe(false);
    expect(area.className).not.toMatch(/overflow-y-auto/);
    height = 300;
    act(() => resize());
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 3, page: 1 }));
    const calls = useProductsMock.mock.calls.length;
    act(() => resize());
    expect(useProductsMock).toHaveBeenCalledTimes(calls);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("clamps a page when the settled server total shrinks", async () => {
    let totalPages = 4;
    useProductsMock.mockImplementation(() => ({ data: { data: [makeProduct("p1", "Producto")], meta: { total: totalPages, totalPages } }, isLoading: false, isFetching: false }));
    const { rerender } = render(<POSPage />);
    await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    totalPages = 1;
    rerender(<POSPage />);
    expect(useProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  });

  it("does not show stale placeholder merchandise counts after toggling services", async () => {
    useProductsMock.mockImplementation((params: UseProductsParams) => ({
      data: { data: [makeProduct("p1", "Mercancia anterior")], meta: { total: 80, totalPages: 4 } },
      isPlaceholderData: params.type === "SERVICE", isFetching: params.type === "SERVICE", isLoading: false,
    }));
    render(<POSPage />);
    await userEvent.click(screen.getByRole("button", { name: "Servicios" }));
    expect(screen.queryByText("80", { selector: "span" })).toBeNull();
    expect(screen.queryByText("Mercancia anterior")).toBeNull();
  });

  it("#19 paginates products and keeps interaction available during page fetch", async () => {
    useProductsMock.mockImplementation((params?: UseProductsParams) => {
      if (params?.search === "nada") {
        return {
          data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } },
          isLoading: false,
          isFetching: false,
        };
      }

      if (params?.page === 2) {
        return {
          data: { data: [makeProduct("2", "Producto Pagina 2")], meta: { total: 2, page: 2, limit: 20, totalPages: 2 } },
          isLoading: false,
          isFetching: true,
        };
      }

      return {
        data: { data: [makeProduct("1", "Producto Pagina 1")], meta: { total: 2, page: 1, limit: 20, totalPages: 2 } },
        isLoading: false,
        isFetching: false,
      };
    });

    render(<POSPage />);

    expect(screen.getByText("Producto Pagina 1")).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    expect(screen.getByText("Producto Pagina 2")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Producto Pagina 2" }));
    expect(screen.getByText("1 en carrito")).toBeTruthy();
  });

  it("#19 shows explicit empty state when search has no results", async () => {
    useProductsMock.mockImplementation((params?: UseProductsParams) => {
      if (params?.search === "sinresultados") {
        return {
          data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } },
          isLoading: false,
          isFetching: false,
        };
      }

      return {
        data: { data: [makeProduct("1", "Producto Base")], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
        isLoading: false,
        isFetching: false,
      };
    });

    render(<POSPage />);
    const searchInput = screen.getByPlaceholderText("Escanear o buscar por nombre, SKU o código...");
    await userEvent.click(searchInput);
    await userEvent.type(searchInput, "sinresultados");

    await waitFor(() => {
      expect(screen.getByText("No se encontraron productos")).toBeTruthy();
    }, { timeout: 2000 });
  });

  it("adds a product to the cart from the dedicated scanner input", async () => {
    useProductsMock.mockReturnValue({
      data: {
        data: [makeProduct("1", "Producto Base")],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    });
    quickSearchMutateMock.mockResolvedValue(makeProduct("scan-1", "Producto Escaneado"));

    render(<POSPage />);

    const scannerInput = screen.getByPlaceholderText("Escanear o buscar por nombre, SKU o código...");
    await userEvent.type(scannerInput, "7701234567890{enter}");

    await waitFor(() => {
      expect(quickSearchMutateMock).toHaveBeenCalledWith("7701234567890");
    });

    expect(screen.getByText("Producto Escaneado agregado al carrito.")).toBeTruthy();
    expect(screen.getByText("1 en carrito")).toBeTruthy();
  });

  it("shows the OFERTA badge and struck list price in the cart for a promoted product (Decimal-string salePrice)", async () => {
    useProductsMock.mockReturnValue({
      data: {
        data: [
          makeProduct("1", "Promo Product", {
            salePrice: "10000" as unknown as number,
            effectiveSalePrice: 8000,
            promotionType: "PERCENTAGE",
            promotionValue: 20,
          }),
        ],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    });

    render(<POSPage />);

    await userEvent.click(screen.getByRole("button", { name: "Promo Product" }));

    expect(screen.getByText(/Oferta -20%/)).toBeTruthy();
    expect(screen.getByTestId("original-unit-price")).toBeTruthy();
  });

  it("does NOT show the OFERTA badge for a product without an active promotion", async () => {
    useProductsMock.mockReturnValue({
      data: {
        data: [
          makeProduct("1", "Sin Oferta", {
            salePrice: "6900" as unknown as number,
            effectiveSalePrice: null,
          }),
        ],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    });

    render(<POSPage />);

    await userEvent.click(screen.getByRole("button", { name: "Sin Oferta" }));

    expect(screen.queryByText(/^Oferta -/)).toBeNull();
    expect(screen.queryByTestId("original-unit-price")).toBeNull();
  });

  it("shows scanner feedback when the scanned code is not found", async () => {
    useProductsMock.mockReturnValue({
      data: {
        data: [makeProduct("1", "Producto Base")],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    });
    quickSearchMutateMock.mockResolvedValue(null);

    render(<POSPage />);

    const scannerInput = screen.getByPlaceholderText("Escanear o buscar por nombre, SKU o código...");
    await userEvent.type(scannerInput, "NO-EXISTE{enter}");

    await waitFor(() => {
      expect(quickSearchMutateMock).toHaveBeenCalledWith("NO-EXISTE");
    });

    expect(screen.getByText("No encontramos un producto con ese código.")).toBeTruthy();
    expect(screen.queryByText("1 en carrito")).toBeNull();
  });

  it("allows a CASHIER user to complete a checkout", async () => {
    useProductsMock.mockReturnValue({
      data: { data: [makeProduct("1", "Producto Checkout")], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
      isLoading: false,
      isFetching: false,
    });

    render(<POSPage />);

    await userEvent.click(screen.getByRole("button", { name: "Producto Checkout" }));
    await userEvent.click(screen.getByRole("button", { name: /tarjeta/i }));
    await userEvent.click(screen.getByRole("button", { name: /finalizar venta/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /confirmar pago/i }, { timeout: 3000 }),
    );

    await waitFor(() => {
      expect(createSaleMutateMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Venta Exitosa")).toBeTruthy();
  });

  it("opens the payment modal through the dynamic loading fallback (S1)", async () => {
    useProductsMock.mockReturnValue({
      data: { data: [makeProduct("1", "Producto Split")], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
      isLoading: false,
      isFetching: false,
    });

    render(<POSPage />);

    await userEvent.click(screen.getByRole("button", { name: "Producto Split" }));
    await userEvent.click(screen.getByRole("button", { name: /finalizar venta/i }));

    // The modal chunk loads lazily: the shared fallback skeleton renders
    // first, then the payment modal opens with identical behavior.
    expect(screen.getByTestId("dynamic-fallback")).toBeTruthy();

    const confirmButton = await screen.findByRole(
      "button",
      { name: /confirmar pago/i },
      { timeout: 3000 },
    );
    expect(confirmButton).toBeTruthy();
  });

  it("shows a thermal print button after checkout and calls printThermalReceipt", async () => {
    useProductsMock.mockReturnValue({
      data: { data: [makeProduct("1", "Producto Checkout")], meta: { total: 1, page: 1, totalPages: 1 } },
      isLoading: false,
      isFetching: false,
    });

    render(<POSPage />);

    await userEvent.click(screen.getByRole("button", { name: "Producto Checkout" }));
    await userEvent.click(screen.getByRole("button", { name: /tarjeta/i }));
    await userEvent.click(screen.getByRole("button", { name: /finalizar venta/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /confirmar pago/i }, { timeout: 3000 }),
    );

    await waitFor(() => {
      expect(createSaleMutateMock).toHaveBeenCalled();
    });

    expect(screen.getByRole("button", { name: /imprimir recibo térmico/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /imprimir recibo térmico/i }));

    await waitFor(() => {
      expect(printThermalReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ id: "sale-1", saleNumber: 101 }),
        "Mi Tienda",
        expect.objectContaining({ header: null, footer: null, logoUrl: "https://res.cloudinary.com/demo/image/upload/logos/store.png" }),
      );
    });
  });

  it("keeps the PDF fallback button that calls printReceipt", async () => {
    useProductsMock.mockReturnValue({
      data: { data: [makeProduct("1", "Producto Checkout")], meta: { total: 1, page: 1, totalPages: 1 } },
      isLoading: false,
      isFetching: false,
    });

    render(<POSPage />);

    await userEvent.click(screen.getByRole("button", { name: "Producto Checkout" }));
    await userEvent.click(screen.getByRole("button", { name: /tarjeta/i }));
    await userEvent.click(screen.getByRole("button", { name: /finalizar venta/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /confirmar pago/i }, { timeout: 3000 }),
    );

    await waitFor(() => {
      expect(createSaleMutateMock).toHaveBeenCalled();
    });

    expect(screen.getByRole("button", { name: /descargar pdf/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /descargar pdf/i }));

    await waitFor(() => {
      expect(printReceipt).toHaveBeenCalledWith("sale-1");
    });
  });

  it("#18 keeps customer selector near checkout, preserves total, and allows checkout without customer", async () => {
    useProductsMock.mockReturnValue({
      data: { data: [makeProduct("1", "Producto Checkout")], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
      isLoading: false,
      isFetching: false,
    });

    render(<POSPage />);

    await userEvent.click(screen.getByRole("button", { name: "Producto Checkout" }));

    const customerLabel = screen.getByText("Cliente (opcional)");
    const totalLabel = screen.getByText("Total");
    expect(customerLabel.compareDocumentPosition(totalLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const totalValueBefore = totalLabel.parentElement?.querySelectorAll("span")[1]?.textContent;
    await userEvent.click(screen.getByRole("button", { name: /sin cliente/i }));
    await userEvent.click(screen.getByText("Ana Perez"));
    const totalValueAfter = totalLabel.parentElement?.querySelectorAll("span")[1]?.textContent;

    expect(totalValueBefore).toBe(totalValueAfter);

    await userEvent.click(screen.getByRole("button", { name: /ana perez/i }));
    await userEvent.click(screen.getByText("Cliente General"));

    await userEvent.click(screen.getByRole("button", { name: /tarjeta/i }));
    await userEvent.click(screen.getByRole("button", { name: /finalizar venta/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /confirmar pago/i }, { timeout: 3000 }),
    );

    await waitFor(() => {
      expect(createSaleMutateMock).toHaveBeenCalled();
    });

    const payload = createSaleMutateMock.mock.calls[0]?.[0] as { customerId?: string };
    expect(payload.customerId).toBeUndefined();
  });

  it("shows a zero-stock service in the grid and bills it into the cart", async () => {
    useProductsMock.mockReturnValue({
      data: {
        data: [makeProduct("9", "Mantenimiento", { type: "SERVICE", stock: 0 })],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    });

    render(<POSPage />);

    await userEvent.click(screen.getByRole("button", { name: "Mantenimiento" }));

    expect(screen.getByText("1 en carrito")).toBeTruthy();
  });

  it("does not cap a service quantity at its stored stock", async () => {
    useProductsMock.mockReturnValue({
      data: {
        data: [makeProduct("9", "Mantenimiento", { type: "SERVICE", stock: 0 })],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    });

    render(<POSPage />);

    const serviceCard = screen.getByRole("button", { name: "Mantenimiento" });
    await userEvent.click(serviceCard);
    await userEvent.click(serviceCard);
    await userEvent.click(serviceCard);

    // The cart header badge counts distinct cart LINES (1 here), not units, so
    // the repeated click is read off the cart line's own quantity control: a
    // service has no stock ceiling and must not be pinned at its stored 0.
    expect(screen.getByDisplayValue("3")).toBeTruthy();
  });

  it("still keeps a zero-stock product out of the grid", async () => {
    useProductsMock.mockImplementation((params: UseProductsParams) => ({
      data: {
        data: params.available ? [] : [makeProduct("7", "Producto Sin Stock", { stock: 0 })],
        meta: { total: params.available ? 0 : 1, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    }));

    render(<POSPage />);

    expect(
      screen.queryByRole("button", { name: "Producto Sin Stock" }),
    ).toBeNull();
  });

  it("filters the grid by item type", async () => {
    useProductsMock.mockImplementation((params: UseProductsParams) => ({
      data: {
        data: [
          makeProduct("1", "Producto Base", { stock: 5 }),
          makeProduct("9", "Mantenimiento", { type: "SERVICE", stock: 0 }),
        ].filter((product) => !params.type || product.type === params.type),
        meta: { total: params.type ? 1 : 2, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    }));

    render(<POSPage />);

    expect(screen.getByRole("button", { name: "Producto Base" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mantenimiento" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /^Servicios$/i }));

    expect(screen.getByRole("button", { name: "Mantenimiento" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Producto Base" }),
    ).toBeNull();
  });
});

describe("POS item price override (pos-edit-item-price)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // SalesService enforces permission; retain ADMIN coverage of the editor.
    authState.role = "ADMIN";
  });

  afterEach(() => {
    authState.role = "CASHIER";
  });

  afterEach(() => {
    cleanup();
  });

  function renderWithSingleProduct(name: string, salePrice: number) {
    useProductsMock.mockReturnValue({
      data: {
        data: [makeProduct("p1", name, { salePrice })],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    });
    return render(<POSPage />);
  }

  async function openDiscountModal() {
    await userEvent.click(screen.getByTitle("Descuento"));
  }

  it("edits a cart line unit price down, keeping the original struck through", async () => {
    renderWithSingleProduct("Producto Precio", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Precio" }));

    await openDiscountModal();
    const priceInput = screen.getByPlaceholderText("Precio");
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "45000");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar precio" }));

    expect(screen.getByTestId("line-unit-price").textContent).toContain(
      formatCurrency(45000),
    );
    expect(screen.getByTestId("original-unit-price").textContent).toContain(
      formatCurrency(50000),
    );
  });

  it("edits a cart line unit price up", async () => {
    renderWithSingleProduct("Producto Precio", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Precio" }));

    await openDiscountModal();
    const priceInput = screen.getByPlaceholderText("Precio");
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "55000");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar precio" }));

    expect(screen.getByTestId("line-unit-price").textContent).toContain(
      formatCurrency(55000),
    );
    expect(screen.getByTestId("original-unit-price").textContent).toContain(
      formatCurrency(50000),
    );
  });

  it("sanitizes a negative price entry to its digits via the COP input", async () => {
    renderWithSingleProduct("Producto Precio", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Precio" }));

    await openDiscountModal();
    const priceInput = screen.getByPlaceholderText("Precio");
    await userEvent.clear(priceInput);
    // CurrencyInput strips non-digit characters, so "-500" reaches the page as 500.
    await userEvent.type(priceInput, "-500");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar precio" }));

    expect(screen.getByTestId("original-unit-price").textContent).toContain(
      formatCurrency(50000),
    );
    expect(screen.getByTestId("line-unit-price").textContent).toContain(
      formatCurrency(500),
    );
  });

  it("recomputes a percentage discount against the edited price", async () => {
    renderWithSingleProduct("Producto Pct", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Pct" }));
    await userEvent.click(screen.getByRole("button", { name: "Producto Pct" }));

    // Apply a 10% percentage discount on quantity 2.
    await openDiscountModal();
    await userEvent.click(screen.getByRole("button", { name: "10%" }));

    // Edit price down to 40000.
    await openDiscountModal();
    const priceInput = screen.getByPlaceholderText("Precio");
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "40000");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar precio" }));

    const discount = screen.getByTestId("line-discount");
    expect(discount.textContent).toContain(formatCurrency(8000));
    expect(discount.textContent).toContain("10%");
  });

  it("retains a fixed-amount discount when the price is edited", async () => {
    renderWithSingleProduct("Producto Fixed", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Fixed" }));

    // Apply a fixed 5000 discount.
    await openDiscountModal();
    await userEvent.type(screen.getByPlaceholderText("0.00"), "5000");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    // Edit price down to 45000.
    await openDiscountModal();
    const priceInput = screen.getByPlaceholderText("Precio");
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "45000");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar precio" }));

    const discount = screen.getByTestId("line-discount");
    expect(discount.textContent).toContain(formatCurrency(5000));
    expect(discount.textContent).not.toContain("%");
  });

  it("clamps a fixed discount so the line total never goes negative", async () => {
    renderWithSingleProduct("Producto Clamp", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Clamp" }));

    // Apply a fixed 5000 discount.
    await openDiscountModal();
    await userEvent.type(screen.getByPlaceholderText("0.00"), "5000");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    // Drop price below the fixed discount (5000) to 3000.
    await openDiscountModal();
    const priceInput = screen.getByPlaceholderText("Precio");
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "3000");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar precio" }));

    const discount = screen.getByTestId("line-discount");
    expect(discount.textContent).toContain(formatCurrency(3000));
  });

  it("shows no strikethrough when the price equals the original", async () => {
    renderWithSingleProduct("Producto NoEdit", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto NoEdit" }));

    expect(screen.queryByTestId("original-unit-price")).toBeNull();
    expect(screen.getByTestId("line-unit-price").textContent).toContain(
      formatCurrency(50000),
    );
  });

  it.each(["ADMIN", "CASHIER"])("sends the edited unit price (not the original) in the checkout payload for %s", async (role) => {
    authState.role = role;
    createSaleMutateMock.mockResolvedValue(makeSale());
    renderWithSingleProduct("Producto Ticket", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Ticket" }));

    // Edit the price down to 45000.
    await openDiscountModal();
    const priceInput = screen.getByPlaceholderText("Precio");
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "45000");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar precio" }));

    // Complete checkout with a card payment (covers the full total).
    await userEvent.click(screen.getByRole("button", { name: /tarjeta/i }));
    await userEvent.click(screen.getByRole("button", { name: /finalizar venta/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /confirmar pago/i }, { timeout: 3000 }),
    );

    await waitFor(() => {
      expect(createSaleMutateMock).toHaveBeenCalled();
    });

    const payload = createSaleMutateMock.mock.calls[0]?.[0] as {
      items: Array<{ productId: string; unitPrice: number; discountAmount: number }>;
    };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].unitPrice).toBe(45000);
    // The original price must not leak into the sale payload.
    expect(payload.items[0]).not.toHaveProperty("originalUnitPrice");
  });

  it("flags an overridden line so the manager can see the deviation in the cart", async () => {
    renderWithSingleProduct("Producto Marcado", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Marcado" }));

    expect(screen.queryByTestId("price-overridden")).toBeNull();

    await openDiscountModal();
    const priceInput = screen.getByPlaceholderText("Precio");
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "45000");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar precio" }));

    expect(screen.getByTestId("price-overridden").textContent).toContain(
      "Precio ajustado",
    );
  });
});

describe("POS price override permission (explicit roles)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSaleMutateMock.mockResolvedValue(makeSale());
  });

  afterEach(() => {
    cleanup();
    authState.role = "CASHIER";
  });

  function renderWithSingleProduct(name: string, salePrice: number) {
    useProductsMock.mockReturnValue({
      data: {
        data: [makeProduct("p1", name, { salePrice })],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
    });
    return render(<POSPage />);
  }

  async function openDiscountModal() {
    await userEvent.click(screen.getByTitle("Descuento"));
  }

  async function expectNoPriceControl(name: string) {
    renderWithSingleProduct(name, 50000);
    await userEvent.click(screen.getByRole("button", { name }));
    await openDiscountModal();

    // The discount half of the modal still works for restricted roles...
    expect(screen.getByPlaceholderText("0.00")).toBeTruthy();
    // ...but the price override is not offered at all.
    expect(screen.queryByRole("button", { name: "Aplicar precio" })).toBeNull();
    expect(screen.queryByPlaceholderText("Precio")).toBeNull();
  }

  it("shows the Aplicar precio control to a CASHIER", async () => {
    authState.role = "CASHIER";
    renderWithSingleProduct("Producto Cajero", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Cajero" }));
    await openDiscountModal();

    expect(screen.getByRole("button", { name: "Aplicar precio" })).toBeTruthy();
  });

  it("hides the Aplicar precio control from a MEMBER", async () => {
    authState.role = "MEMBER";
    await expectNoPriceControl("Producto Miembro");
  });

  it("hides the Aplicar precio control when there is no user", async () => {
    authState.role = "";
    await expectNoPriceControl("Producto Anonimo");
  });

  it("shows the Aplicar precio control to an ADMIN", async () => {
    authState.role = "ADMIN";
    renderWithSingleProduct("Producto Admin", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Admin" }));
    await openDiscountModal();

    expect(screen.getByRole("button", { name: "Aplicar precio" })).toBeTruthy();
  });

  it("shows the Aplicar precio control to an OWNER (inherits ADMIN)", async () => {
    // Mirrors RolesGuard.getInheritedRoles, where OWNER inherits ADMIN.
    authState.role = "OWNER";
    renderWithSingleProduct("Producto Owner", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Owner" }));
    await openDiscountModal();

    expect(screen.getByRole("button", { name: "Aplicar precio" })).toBeTruthy();
  });

  it("omits unitPrice from the payload for a CASHIER so the server derives it", async () => {
    // Unedited lines omit the price so current promotions remain server-derived.
    authState.role = "CASHIER";
    renderWithSingleProduct("Producto Server", 50000);
    await userEvent.click(screen.getByRole("button", { name: "Producto Server" }));

    await userEvent.click(screen.getByRole("button", { name: /tarjeta/i }));
    await userEvent.click(screen.getByRole("button", { name: /finalizar venta/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /confirmar pago/i }, { timeout: 3000 }),
    );

    await waitFor(() => {
      expect(createSaleMutateMock).toHaveBeenCalled();
    });

    const payload = createSaleMutateMock.mock.calls[0]?.[0] as {
      items: Array<{ productId: string; unitPrice?: number }>;
    };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).not.toHaveProperty("unitPrice");
  });

  it("omits unitPrice from the payload when the line matches the product price", async () => {
    authState.role = "ADMIN";
    renderWithSingleProduct("Producto Sin Editar", 50000);
    await userEvent.click(
      screen.getByRole("button", { name: "Producto Sin Editar" }),
    );

    await userEvent.click(screen.getByRole("button", { name: /tarjeta/i }));
    await userEvent.click(screen.getByRole("button", { name: /finalizar venta/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /confirmar pago/i }, { timeout: 3000 }),
    );

    await waitFor(() => {
      expect(createSaleMutateMock).toHaveBeenCalled();
    });

    const payload = createSaleMutateMock.mock.calls[0]?.[0] as {
      items: Array<{ unitPrice?: number }>;
    };
    expect(payload.items[0]).not.toHaveProperty("unitPrice");
  });
});

describe("POS promotion pricing (#74)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pausedSalesState.list = [];
  });

  afterEach(() => {
    cleanup();
  });

  function renderWithProducts(list: Product[]) {
    useProductsMock.mockReturnValue({
      data: { data: list, meta: { total: list.length, page: 1, limit: 20, totalPages: 1 } },
      isLoading: false,
      isFetching: false,
    });
    return render(<POSPage />);
  }

  it("adds a grid product to the cart at the promotional effective price, snapshotting the list price", async () => {
    renderWithProducts([
      makeProduct("promo-1", "Producto Oferta", {
        salePrice: 10000,
        effectiveSalePrice: 8000,
        promotionType: "PERCENTAGE",
        promotionValue: 20,
      }),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Producto Oferta" }));

    expect(screen.getByTestId("line-unit-price").textContent).toContain(
      formatCurrency(8000),
    );
    expect(screen.getByTestId("original-unit-price").textContent).toContain(
      formatCurrency(10000),
    );
  });

  it("adds a scanned product to the cart at its promotional effective price", async () => {
    renderWithProducts([makeProduct("base-1", "Producto Base")]);
    quickSearchMutateMock.mockResolvedValue(
      makeProduct("promo-scan", "Producto Escaneado Oferta", {
        salePrice: 19900,
        effectiveSalePrice: 16915,
        promotionType: "PERCENTAGE",
        promotionValue: 15,
      }),
    );

    const scannerInput = screen.getByPlaceholderText("Escanear o buscar por nombre, SKU o código...");
    await userEvent.type(scannerInput, "7709876543210{enter}");

    await waitFor(() => {
      expect(screen.getByText("Producto Escaneado Oferta agregado al carrito.")).toBeTruthy();
    });

    expect(screen.getByTestId("line-unit-price").textContent).toContain(
      formatCurrency(16915),
    );
    expect(screen.getByTestId("original-unit-price").textContent).toContain(
      formatCurrency(19900),
    );
  });

  it("caps a manual rebate at the promotional gross so the line totals zero, never negative", async () => {
    renderWithProducts([
      makeProduct("promo-cap", "Producto Tope", {
        salePrice: 10000,
        effectiveSalePrice: 8000,
        promotionType: "PERCENTAGE",
        promotionValue: 20,
      }),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Producto Tope" }));

    await userEvent.click(screen.getByTitle("Descuento"));
    await userEvent.type(screen.getByPlaceholderText("0.00"), "99999");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    // Rebate caps at the offer gross (8000 × 1) — line total floors at $0.
    const discount = screen.getByTestId("line-discount");
    expect(discount.textContent).toContain(formatCurrency(8000));
    expect(screen.getByTestId("line-unit-price").textContent).toContain(
      formatCurrency(8000),
    );
  });

  it("recomputes a percentage rebate against the offer price when quantity grows", async () => {
    renderWithProducts([
      makeProduct("promo-qty", "Producto Cantidad", {
        salePrice: 10000,
        effectiveSalePrice: 8000,
        promotionType: "PERCENTAGE",
        promotionValue: 20,
      }),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Producto Cantidad" }));
    await userEvent.click(screen.getByRole("button", { name: "Producto Cantidad" }));

    await userEvent.click(screen.getByTitle("Descuento"));
    await userEvent.click(screen.getByRole("button", { name: "10%" }));

    // Offer gross at qty 2 is 16000 → 10% rebate = 1600, anchored to the
    // promotional unitPrice (not the 10000 list price, which would give 2000).
    expect(screen.getByTestId("line-discount").textContent).toContain(
      formatCurrency(1600),
    );
  });

  it("reprices a paused cart line from the current product state on resume, re-clamping the rebate", async () => {
    const staleProduct = makeProduct("promo-stale", "Producto Pausado", {
      salePrice: 10000,
      effectiveSalePrice: 8000,
      promotionType: "PERCENTAGE",
      promotionValue: 20,
    });
    pausedSalesState.list = [
      {
        id: "paused-1",
        customerId: "",
        discountAmount: 0,
        pausedAt: "2026-08-25T10:00:00.000Z",
        cart: [
          {
            productId: "promo-stale",
            product: staleProduct,
            quantity: 1,
            unitPrice: 8000,
            originalUnitPrice: 10000,
            discountAmount: 7500,
            availableStock: 10,
          },
        ],
      },
    ];
    renderWithProducts([makeProduct("base-1", "Producto Base")]);

    resumeSaleMock.mockReturnValue({
      id: "paused-1",
      customerId: "",
      discountAmount: 0,
      pausedAt: "2026-08-25T10:00:00.000Z",
      cart: [
        {
          productId: "promo-stale",
          product: staleProduct,
          quantity: 1,
          unitPrice: 8000,
          originalUnitPrice: 10000,
          discountAmount: 7500,
          availableStock: 10,
        },
      ],
    });
    // Promo was removed while paused: list price is now 5000, no offer.
    apiGetMock.mockResolvedValue({
      data: makeProduct("promo-stale", "Producto Pausado", { salePrice: 5000 }),
    });

    await userEvent.click(screen.getByRole("button", { name: "Reanudar (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Reanudar" }));

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith("/products/promo-stale");
    });

    // Line repriced from the fresh product (list price after promo removal)…
    expect(screen.getByTestId("line-unit-price").textContent).toContain(
      formatCurrency(5000),
    );
    // …and the stale rebate shrank to the new unit price instead of going negative.
    expect(screen.getByTestId("line-discount").textContent).toContain(
      formatCurrency(5000),
    );
  });
});

describe("POS cart financing (pos-loan-initiation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pausedSalesState.list = [];
  });

  afterEach(() => {
    cleanup();
    pausedSalesState.list = [];
  });

  function renderWithProducts(list: Product[]) {
    useProductsMock.mockReturnValue({
      data: { data: list, meta: { total: list.length, page: 1, limit: 20, totalPages: 1 } },
      isLoading: false,
      isFetching: false,
    });
    return render(<POSPage />);
  }

  const financeAction = () => screen.getByRole("button", { name: /financiar/i });
  const confirmFinance = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Financiar venta" }));
  };
  const cancelFinance = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  };
  const dismissFinance = async () => {
    await userEvent.click(screen.getByTestId("confirm-backdrop"));
  };
  const confirmMessage = () => screen.getByTestId("confirm-message").textContent ?? "";

  async function selectAnaPerez() {
    await userEvent.click(screen.getByRole("button", { name: /sin cliente/i }));
    await userEvent.click(screen.getByText("Ana Perez"));
  }

  /** Seed the sale-wide discount through the only existing POS path: resuming a paused cart. */
  function seedPausedCart(product: Product, discountAmount: number) {
    const paused = {
      id: "paused-finance",
      customerId: "",
      discountAmount,
      pausedAt: "2026-08-25T10:00:00.000Z",
      cart: [
        {
          productId: product.id,
          product,
          quantity: 1,
          unitPrice: product.salePrice,
          originalUnitPrice: product.salePrice,
          discountAmount: 0,
          availableStock: 10,
        },
      ],
    };
    pausedSalesState.list = [paused];
    resumeSaleMock.mockReturnValue(paused);
    apiGetMock.mockResolvedValue({ data: product });
  }

  async function resumePausedCart() {
    await userEvent.click(screen.getByRole("button", { name: "Reanudar (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Reanudar" }));
    await waitFor(() => {
      expect(screen.getByTestId("line-unit-price")).toBeTruthy();
      expect(screen.getByText("Descuento")).toBeTruthy();
    });
  }

  function initiation() {
    return {
      intentId: "intent-1",
      loanId: "loan-1",
      organizationId: "org-1",
      customerId: "customer-1",
      agreedCustomerTotal: "12345.00",
      quoteSnapshot: {},
    };
  }

  it("renders a financing action next to checkout, disabled until a cart and customer exist", async () => {
    renderWithProducts([makeProduct("p1", "Producto Financiado", { salePrice: 50000 })]);

    expect(financeAction()).toBeDisabled();
    expect(screen.getByRole("button", { name: /finalizar venta/i })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Producto Financiado" }));
    expect(financeAction()).toBeDisabled();

    await selectAnaPerez();
    expect(financeAction()).not.toBeDisabled();
  });

  it("opens a confirmation naming the customer and the amount to finance instead of initiating immediately", async () => {
    const product = makeProduct("p1", "Producto Financiado", { salePrice: 50000 });
    seedPausedCart(product, 5000);
    renderWithProducts([product]);
    await resumePausedCart();
    await selectAnaPerez();

    await userEvent.click(financeAction());

    // Nothing is initiated until the cashier confirms the debt.
    expect(createPosLoanMutateMock).not.toHaveBeenCalled();
    // The confirm button reads like an action, not like a dismissal.
    expect(screen.getByRole("button", { name: "Financiar venta" })).toBeTruthy();
    const message = confirmMessage();
    expect(message).toContain("Ana Perez");
    // Pre-server figure: the client-computed amount to finance, not the agreed total.
    expect(message).toContain(formatCurrency(45000));
    expect(message).toContain("Monto a financiar");
  });

  it("cancelling the confirmation leaves the cart, the customer and the discount untouched and never calls the mutation", async () => {
    const product = makeProduct("p1", "Producto Financiado", { salePrice: 50000 });
    seedPausedCart(product, 5000);
    renderWithProducts([product]);
    await resumePausedCart();
    await selectAnaPerez();

    await userEvent.click(financeAction());
    await cancelFinance();

    expect(createPosLoanMutateMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Financiar venta" })).toBeNull();
    expect(screen.getByTestId("line-unit-price")).toBeTruthy();
    expect(screen.getByRole("button", { name: /ana perez/i })).toBeTruthy();
    expect(screen.getByText("Descuento")).toBeTruthy();
  });

  it("dismissing the confirmation does not consume the request key, and a later confirm uses one generated key", async () => {
    const product = makeProduct("p1", "Producto Financiado", { salePrice: 50000 });
    createPosLoanMutateMock.mockResolvedValue(initiation());
    seedPausedCart(product, 5000);
    renderWithProducts([product]);
    await resumePausedCart();
    await selectAnaPerez();

    await userEvent.click(financeAction());
    await dismissFinance();
    expect(createPosLoanMutateMock).not.toHaveBeenCalled();

    await userEvent.click(financeAction());
    await confirmFinance();
    await waitFor(() => expect(createPosLoanMutateMock).toHaveBeenCalledTimes(1));

    const key = (createPosLoanMutateMock.mock.calls[0]?.[0] as { requestKey: string })
      .requestKey;
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("initiates with the cart items, the selected customer, the global discount and a generated requestKey, surfacing the server total", async () => {
    const product = makeProduct("p1", "Producto Financiado", { salePrice: 50000 });
    createPosLoanMutateMock.mockResolvedValue(initiation());
    seedPausedCart(product, 5000);
    renderWithProducts([product]);
    await resumePausedCart();
    await selectAnaPerez();

    await userEvent.click(financeAction());
    expect(createPosLoanMutateMock).not.toHaveBeenCalled();
    await confirmFinance();
    await waitFor(() => expect(createPosLoanMutateMock).toHaveBeenCalledTimes(1));

    const payload = createPosLoanMutateMock.mock.calls[0]?.[0] as {
      customerId: string;
      requestKey: string;
      discountAmount: number;
      items: Array<Record<string, unknown>>;
    };
    expect(payload.customerId).toBe("customer-1");
    expect(typeof payload.requestKey).toBe("string");
    expect(payload.requestKey.length).toBeGreaterThan(0);
    expect(payload.discountAmount).toBe(5000);
    expect(payload.items).toEqual([{ productId: "p1", quantity: 1, discountAmount: 0 }]);
    expect(payload.items[0]).not.toHaveProperty("unitPrice");

    // The surfaced money must be the server agreed total, never the client-computed 45000.
    await waitFor(() =>
      expect(
        screen.getAllByText((_, el) => (el?.textContent ?? "").includes(formatCurrency(12345))).length,
      ).toBeGreaterThan(0),
    );
  });

  it("reuses the request key on a failed retry and clears the cart, customer and discount only after success", async () => {
    const product = makeProduct("p1", "Producto Financiado", { salePrice: 50000 });
    createPosLoanMutateMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(initiation());
    seedPausedCart(product, 5000);
    renderWithProducts([product]);
    await resumePausedCart();
    await selectAnaPerez();

    await userEvent.click(financeAction());
    await confirmFinance();
    await waitFor(() => expect(createPosLoanMutateMock).toHaveBeenCalledTimes(1));

    // A failed attempt must not clear the cart, the customer or the discount.
    expect(screen.getByTestId("line-unit-price")).toBeTruthy();
    expect(screen.getByRole("button", { name: /ana perez/i })).toBeTruthy();
    expect(screen.getByText("Descuento")).toBeTruthy();

    await userEvent.click(financeAction());
    await confirmFinance();
    await waitFor(() => expect(createPosLoanMutateMock).toHaveBeenCalledTimes(2));

    const keys = createPosLoanMutateMock.mock.calls.map(
      (call) => (call[0] as { requestKey: string }).requestKey,
    );
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0].length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getByText("Carrito vacío")).toBeTruthy());
    expect(screen.queryByTestId("line-unit-price")).toBeNull();
    expect(screen.getByRole("button", { name: /sin cliente/i })).toBeTruthy();
    expect(screen.queryByText("Descuento")).toBeNull();
  });
});
