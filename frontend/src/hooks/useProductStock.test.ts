import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement, type ReactNode } from "react";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import {
  productStockQueryKey,
  useAdjustProductStock,
  useProductStockBySite,
} from "./useProductStock";

/**
 * T22 — the per-site stock read and adjustment contract.
 *
 * The breakdown belongs to one product, so its query is keyed by it; the
 * adjustment posts the signed move and refreshes the product list, the product
 * detail and that product's breakdown, which is every surface that shows the
 * units it just changed.
 */
const respond = (data: unknown) =>
  ({ data }) as unknown as Awaited<ReturnType<typeof api.get>>;

const sites = [
  {
    locationId: "site-a",
    name: "Principal",
    type: "STORE",
    isDefault: true,
    stock: 5,
    reservedStock: 1,
    availableStock: 4,
  },
  {
    locationId: "site-b",
    name: "Bodega",
    type: "WAREHOUSE",
    isDefault: false,
    stock: 0,
    reservedStock: 0,
    availableStock: 0,
  },
];

let client: QueryClient;
let wrapper: ({ children }: { children: ReactNode }) => ReactElement;

describe("useProductStock", () => {
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    wrapper = ({ children }) =>
      createElement(QueryClientProvider, { client }, children);
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  it("reads the breakdown of one product at its own key", async () => {
    vi.mocked(api.get).mockResolvedValue(respond(sites));

    const { result } = renderHook(() => useProductStockBySite("p-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/products/p-1/stock-by-site");
    expect(result.current.data).toEqual(sites);
    expect(client.getQueryData(productStockQueryKey("p-1"))).toEqual(sites);
  });

  it("never asks for a product that is not open", () => {
    renderHook(() => useProductStockBySite(null), { wrapper });

    expect(api.get).not.toHaveBeenCalled();
  });

  it("posts the signed move with its site and reason", async () => {
    vi.mocked(api.post).mockResolvedValue(
      respond({ product: { id: "p-1" }, site: sites[1] }),
    );

    const { result } = renderHook(() => useAdjustProductStock(), { wrapper });

    await result.current.mutateAsync({
      productId: "p-1",
      locationId: "site-b",
      quantity: -3,
      reason: "Merma de bodega",
    });

    expect(api.post).toHaveBeenCalledWith("/products/p-1/stock-adjustments", {
      locationId: "site-b",
      quantity: -3,
      reason: "Merma de bodega",
    });
  });

  it("refreshes the list, the product and its breakdown after a move", async () => {
    vi.mocked(api.post).mockResolvedValue(
      respond({ product: { id: "p-1" }, site: sites[1] }),
    );
    client.setQueryData(productStockQueryKey("p-1"), sites);
    client.setQueryData(["product", "p-1"], { id: "p-1", stock: 5 });
    client.setQueryData(["products", {}], { data: [], meta: {} });

    const { result } = renderHook(() => useAdjustProductStock(), { wrapper });

    await result.current.mutateAsync({
      productId: "p-1",
      locationId: "site-b",
      quantity: 2,
      reason: "Conteo físico",
    });

    await waitFor(() =>
      expect(client.getQueryState(productStockQueryKey("p-1"))?.isInvalidated).toBe(
        true,
      ),
    );
    expect(client.getQueryState(["product", "p-1"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["products", {}])?.isInvalidated).toBe(true);
  });
});
