import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useCommandSearch } from "./useCommandSearch";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));

const apiMock = api as unknown as { get: ReturnType<typeof vi.fn> };

const productHit = {
  id: "product-1",
  name: "Arroz 1 kg",
  sku: "ALI-002",
  barcode: null,
  salePrice: 3500,
  effectiveSalePrice: 3200,
};

const customerHit = {
  id: "customer-1",
  name: "Ana Pérez",
  documentNumber: "10203040",
};

const saleHit = {
  id: "sale-1",
  saleNumber: 194,
  total: 12000,
  status: "COMPLETED",
  customer: { name: "Ana Pérez" },
};

function paginated<T>(data: T[]) {
  return {
    data: {
      data,
      meta: { total: data.length, page: 1, limit: 5, totalPages: 1 },
    },
  };
}

/** Answers each endpoint with the fixture that belongs to it. */
function respondByEndpoint() {
  apiMock.get.mockImplementation((url: string) => {
    if (url === "/products/search") {
      return Promise.resolve({ data: [productHit] });
    }
    if (url === "/products") return Promise.resolve(paginated([productHit]));
    if (url === "/customers") return Promise.resolve(paginated([customerHit]));
    if (url === "/sales") return Promise.resolve(paginated([saleHit]));
    return Promise.reject(new Error(`unexpected endpoint ${url}`));
  });
}

// The palette reads its groups through the app's query cache; one client per
// test keeps the keys (and therefore the request counts) honest.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  apiMock.get.mockReset();
  queryClient.clear();
});

describe("useCommandSearch", () => {
  it("asks nothing until the query reaches two characters", async () => {
    respondByEndpoint();
    const { result } = renderHook(() => useCommandSearch("a", "ADMIN"), {
      wrapper,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(apiMock.get).not.toHaveBeenCalled();
    expect(result.current.products.status).toBe("idle");
  });

  it("debounces a burst of keystrokes into one request per group", async () => {
    respondByEndpoint();
    const { rerender } = renderHook(
      ({ query }) => useCommandSearch(query, "ADMIN"),
      { initialProps: { query: "ar" }, wrapper },
    );

    rerender({ query: "arr" });
    rerender({ query: "arroz" });

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(3));

    const urls = apiMock.get.mock.calls.map(([url]) => url);
    expect(urls).toHaveLength(3);
    expect(new Set(urls)).toEqual(
      new Set(["/products/search", "/customers", "/sales"]),
    );

    const productCall = apiMock.get.mock.calls.find(
      ([url]) => url === "/products/search",
    );
    expect(productCall?.[1]).toEqual({ q: "arroz", limit: 5 });
  });

  it("returns one hit per group with the server's price", async () => {
    respondByEndpoint();
    const { result } = renderHook(() => useCommandSearch("arroz", "ADMIN"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.products.status).toBe("ready"));

    expect(result.current.products.items).toEqual([
      {
        id: "product-1",
        name: "Arroz 1 kg",
        sku: "ALI-002",
        barcode: null,
        price: 3200,
      },
    ]);
    expect(result.current.customers.items[0]).toMatchObject({
      id: "customer-1",
      documentNumber: "10203040",
    });
    expect(result.current.sales.items[0]).toMatchObject({
      id: "sale-1",
      saleNumber: 194,
      customerName: "Ana Pérez",
    });
  });

  it("hides the groups the role cannot read from the API", async () => {
    respondByEndpoint();
    const { result } = renderHook(
      () => useCommandSearch("arroz", "INVENTORY_USER"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.products.status).toBe("ready"));

    const urls = apiMock.get.mock.calls.map(([url]) => url);
    expect(urls).not.toContain("/sales");
    expect(urls).not.toContain("/customers");
    // The inventory role reads products from the list endpoint instead.
    expect(urls).toContain("/products");
    expect(result.current.sales.status).toBe("idle");
  });

  it("keeps the other groups when one endpoint fails", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/sales") return Promise.reject(new Error("500"));
      if (url === "/customers") return Promise.resolve(paginated([customerHit]));
      return Promise.resolve({ data: [productHit] });
    });

    const { result } = renderHook(() => useCommandSearch("arroz", "ADMIN"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.sales.status).toBe("error"));

    expect(result.current.customers.items).toHaveLength(1);
    expect(result.current.products.status).toBe("ready");
  });

  it("ignores a stale response that lands after a newer query", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    apiMock.get.mockImplementation((url: string) => {
      if (url !== "/customers") return Promise.resolve(paginated([]));
      if (!apiMock.get.mock.calls.some(([u, p]) => u === url && p?.search === "arroz")) {
        return first;
      }
      return Promise.resolve(
        paginated([{ ...customerHit, id: "customer-late", name: "Arroz" }]),
      );
    });

    const { result, rerender } = renderHook(
      ({ query }) => useCommandSearch(query, "ADMIN"),
      { initialProps: { query: "ar" }, wrapper },
    );

    // The first request is still in flight when the operator keeps typing.
    await waitFor(() =>
      expect(apiMock.get).toHaveBeenCalledWith("/customers", {
        search: "ar",
        limit: 5,
      }),
    );

    rerender({ query: "arroz" });
    await waitFor(() =>
      expect(result.current.customers.items[0]?.id).toBe("customer-late"),
    );

    // The abandoned request resolves late and must not overwrite the newer list.
    await act(async () => {
      resolveFirst(paginated([{ ...customerHit, id: "customer-stale" }]));
      await Promise.resolve();
    });

    expect(result.current.customers.items.map((item) => item.id)).toEqual([
      "customer-late",
    ]);
  });

  it("sends a sale number without the words around it", async () => {
    respondByEndpoint();
    const { result } = renderHook(
      () => useCommandSearch("venta 194", "ADMIN"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.sales.status).toBe("ready"));

    expect(apiMock.get).toHaveBeenCalledWith("/sales", {
      search: "194",
      limit: 5,
    });
  });
});
