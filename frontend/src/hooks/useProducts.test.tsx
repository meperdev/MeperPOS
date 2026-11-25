import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

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
  useProducts,
  useQuickSearchProduct,
  useSearchProducts,
} from "./useProducts";

/**
 * T3f — the POS catalogue, its search and its quick search carry the active
 * site. Screens that do not ask for a site keep the organization-wide request
 * byte for byte, and a site change never shows the previous site's stock while
 * the replacement loads.
 */
const respond = (data: unknown) =>
  ({ data }) as unknown as Awaited<ReturnType<typeof api.get>>;

const page = (rows: { id: string }[] = []) => ({
  data: rows,
  meta: { total: rows.length, page: 1, limit: 3, totalPages: 1 },
});

let client: QueryClient;
let wrapper: ({ children }: { children: ReactNode }) => ReactElement;

describe("useProducts site scope", () => {
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(api.get).mockReset();
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  it("sends the requested site and keys the query by it", async () => {
    vi.mocked(api.get).mockResolvedValue(respond(page([{ id: "p1" }])));

    const { result } = renderHook(
      () => useProducts({ page: 1, limit: 3, locationId: "site-a" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data?.data).toHaveLength(1));
    expect(api.get).toHaveBeenCalledWith("/products", {
      page: 1,
      limit: 3,
      locationId: "site-a",
    });
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ["products"] })
        .map((query) => query.queryKey),
    ).toEqual([["products", { page: 1, limit: 3, locationId: "site-a" }]]);
  });

  it("keeps the organization-wide request unchanged when no site is asked for", async () => {
    vi.mocked(api.get).mockResolvedValue(respond(page()));

    const { result } = renderHook(() => useProducts({ page: 1, limit: 3 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/products", { page: 1, limit: 3 });
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ["products"] })
        .map((query) => query.queryKey),
    ).toEqual([["products", { page: 1, limit: 3 }]]);
  });

  it("never shows the previous site's rows while the new site loads", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(respond(page([{ id: "site-a-product" }])))
      .mockImplementationOnce(() => new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ locationId }: { locationId: string }) =>
        useProducts({ page: 1, limit: 3, locationId }),
      { wrapper, initialProps: { locationId: "site-a" } },
    );

    await waitFor(() =>
      expect(result.current.data?.data).toEqual([{ id: "site-a-product" }]),
    );

    rerender({ locationId: "site-b" });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);
  });
});

describe("useSearchProducts site scope", () => {
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(api.get).mockReset();
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  it("forwards the requested site and keys the query by it", async () => {
    vi.mocked(api.get).mockResolvedValue(respond([{ id: "p1" }]));

    const { result } = renderHook(
      () => useSearchProducts("panela", 20, "site-b"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(api.get).toHaveBeenCalledWith("/products/search", {
      q: "panela",
      limit: 20,
      locationId: "site-b",
    });
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ["products"] })
        .map((query) => query.queryKey),
    ).toEqual([["products", "search", "panela", 20, "site-b"]]);
  });

  it("keeps the organization-wide search unchanged without a site", async () => {
    vi.mocked(api.get).mockResolvedValue(respond([{ id: "p1" }]));

    const { result } = renderHook(() => useSearchProducts("panela", 20), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(api.get).toHaveBeenCalledWith("/products/search", {
      q: "panela",
      limit: 20,
    });
  });
});

describe("useQuickSearchProduct site scope", () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(api.get).mockReset();
  });

  afterEach(() => cleanup());

  it("sends the requested site with the scanned code", async () => {
    vi.mocked(api.get).mockResolvedValue(respond({ id: "p1" }));

    const { result } = renderHook(
      () => useQuickSearchProduct({ locationId: "site-a" }),
      { wrapper },
    );
    await result.current.mutateAsync("7701234567890");

    expect(api.get).toHaveBeenCalledWith("/products/quick-search", {
      code: "7701234567890",
      locationId: "site-a",
    });
  });

  it("keeps the organization-wide scan unchanged without a site", async () => {
    vi.mocked(api.get).mockResolvedValue(respond(null));

    const { result } = renderHook(() => useQuickSearchProduct(), { wrapper });
    await result.current.mutateAsync("7701234567890");

    expect(api.get).toHaveBeenCalledWith("/products/quick-search", {
      code: "7701234567890",
    });
  });
});
