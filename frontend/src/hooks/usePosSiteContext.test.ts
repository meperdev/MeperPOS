import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { api } from "@/lib/api";
import { usePosSiteContext } from "./usePosSiteContext";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));

const get = vi.mocked(api.get);

const context = {
  locations: [
    {
      id: "site-a",
      name: "Centro",
      type: "STORE",
      isDefault: true,
      address: "Calle 10 #5-20",
      phone: "300 123 4567",
    },
  ],
  checkoutLocationId: "site-a",
};

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePosSiteContext", () => {
  it("binds the context read to the rendered user and tenant", async () => {
    get.mockResolvedValue({ data: context } as never);
    const client = new QueryClient();

    const { result } = renderHook(() => usePosSiteContext("user-1", "org-1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.data).toEqual(context));
    // The picker draws each store's contact details straight from this payload.
    expect(result.current.data?.locations[0]).toMatchObject({
      address: "Calle 10 #5-20",
      phone: "300 123 4567",
    });
    const [url, params, config] = get.mock.calls[0];
    expect(url).toBe("/locations/pos-context");
    expect(params).toBeUndefined();
    expect(config).toMatchObject({
      posScope: { userId: "user-1", organizationId: "org-1" },
    });
    // A POS context must be cancellable: the gate aborts a stale read.
    expect((config as { signal?: unknown }).signal).toBeDefined();
  });

  it("verifies eligibility again on every mount instead of reusing a cache", async () => {
    get.mockResolvedValue({ data: context } as never);
    const client = new QueryClient();

    const first = renderHook(() => usePosSiteContext("user-1", "org-1"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => usePosSiteContext("user-1", "org-1"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(get).toHaveBeenCalledTimes(2);
    // Both reads run under the rendered identity, never a remembered one.
    for (const [, , config] of get.mock.calls) {
      expect(config).toMatchObject({
        posScope: { userId: "user-1", organizationId: "org-1" },
      });
    }
  });

  it("keeps one query per user and organization", async () => {
    get.mockResolvedValue({ data: context } as never);
    const client = new QueryClient();

    const first = renderHook(() => usePosSiteContext("user-1", "org-1"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    renderHook(() => usePosSiteContext("user-2", "org-1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get.mock.calls[1][2]).toMatchObject({
      posScope: { userId: "user-2", organizationId: "org-1" },
    });
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([
      ["pos-site-context", "user-1", "org-1"],
      ["pos-site-context", "user-2", "org-1"],
    ]);
  });
});
