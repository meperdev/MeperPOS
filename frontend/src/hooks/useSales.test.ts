import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { api } from "@/lib/api";
import { HAPTIC_PATTERNS } from "@/lib/haptics";
import { useCreateSale } from "./useSales";

vi.mock("@/lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn() },
}));

const post = vi.mocked(api.post);
const vibrate = vi.fn(() => true);

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

afterEach(() => {
  vi.clearAllMocks();
  delete (navigator as unknown as Record<string, unknown>).vibrate;
});

describe("useCreateSale", () => {
  it("buzzes the success pattern once the sale is recorded", async () => {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: vibrate,
    });
    post.mockResolvedValue({ data: { id: "sale-1", saleNumber: 1 } } as never);

    const { result } = renderHook(() => useCreateSale(), { wrapper: wrapper() });

    await result.current.mutateAsync({
      items: [{ productId: "p1", quantity: 1, discountAmount: 0 }],
    });

    await waitFor(() => expect(vibrate).toHaveBeenCalledTimes(1));
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.success);
  });

  it("stays silent when the sale is rejected", async () => {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: vibrate,
    });
    post.mockRejectedValue(new Error("409"));

    const { result } = renderHook(() => useCreateSale(), { wrapper: wrapper() });

    await expect(
      result.current.mutateAsync({ items: [{ productId: "p1", quantity: 1, discountAmount: 0 }] }),
    ).rejects.toThrow("409");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("posts the cart to /sales", async () => {
    post.mockResolvedValue({ data: { id: "sale-1" } } as never);
    const { result } = renderHook(() => useCreateSale(), { wrapper: wrapper() });

    await result.current.mutateAsync({ items: [{ productId: "p1", quantity: 2, discountAmount: 0 }] });

    expect(post).toHaveBeenCalledWith("/sales", {
      items: [{ productId: "p1", quantity: 2, discountAmount: 0 }],
    });
  });

  it("forwards a pinned requestKey unchanged so the server can replay instead of duplicating", async () => {
    post.mockResolvedValue({ data: { id: "sale-1" } } as never);
    const { result } = renderHook(() => useCreateSale(), { wrapper: wrapper() });

    await result.current.mutateAsync({
      items: [{ productId: "p1", quantity: 2, discountAmount: 0 }],
      requestKey: "checkout-attempt-key",
    });

    expect(post).toHaveBeenCalledWith("/sales", {
      items: [{ productId: "p1", quantity: 2, discountAmount: 0 }],
      requestKey: "checkout-attempt-key",
    });
  });

  it("charges at the active POS site, bound to the same request scope", async () => {
    post.mockResolvedValue({ data: { id: "sale-1" } } as never);
    const scope = { userId: "user-1", organizationId: "org-1" };
    const { result } = renderHook(
      () => useCreateSale(scope, "site-b"),
      { wrapper: wrapper() },
    );

    await result.current.mutateAsync({
      items: [{ productId: "p1", quantity: 2, discountAmount: 0 }],
      requestKey: "checkout-attempt-key",
    });

    expect(post).toHaveBeenCalledWith(
      "/sales",
      {
        items: [{ productId: "p1", quantity: 2, discountAmount: 0 }],
        requestKey: "checkout-attempt-key",
        locationId: "site-b",
      },
      { posScope: scope },
    );
  });

  it("keeps the plain sale for a caller without an active site", async () => {
    post.mockResolvedValue({ data: { id: "sale-1" } } as never);
    const { result } = renderHook(() => useCreateSale(undefined, undefined), {
      wrapper: wrapper(),
    });

    await result.current.mutateAsync({
      items: [{ productId: "p1", quantity: 1, discountAmount: 0 }],
    });

    expect(post).toHaveBeenCalledWith("/sales", {
      items: [{ productId: "p1", quantity: 1, discountAmount: 0 }],
    });
    expect(post.mock.calls[0][1]).not.toHaveProperty("locationId");
  });
});
