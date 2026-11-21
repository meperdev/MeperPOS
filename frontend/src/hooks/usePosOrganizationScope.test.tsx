import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { SELECTED_ORGANIZATION_KEY } from "@/lib/session";
import { api } from "@/lib/api";
import { useCreatePosLoan } from "@/hooks/useLoans";
import { useCreateSale } from "@/hooks/useSales";
import * as scopeHooks from "@/hooks/usePosSiteContext";

it("drops old unscoped POS query data before observing a cross-tab organization switch", async () => {
  const queryClient = new QueryClient();
  const storage = window.localStorage;
  const queryKey = ["products", { available: true }];
  const load = vi.fn(async () => storage.getItem(SELECTED_ORGANIZATION_KEY));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  storage.setItem(SELECTED_ORGANIZATION_KEY, "org-a");
  queryClient.setQueryData(queryKey, "org-a");
  try {
    const { result, unmount } = renderHook(() => {
      const organizationId = scopeHooks.usePosOrganizationScope(true);
      const products = useQuery({ queryKey, queryFn: load, staleTime: Infinity });
      return { organizationId, products: products.data };
    }, { wrapper });
    expect(result.current).toEqual({ organizationId: "org-a", products: "org-a" });
    act(() => {
      storage.setItem(SELECTED_ORGANIZATION_KEY, "org-b");
      // jsdom rejects its own Storage as a StorageEventInit member, and the
      // subscriber only reads key/oldValue/newValue.
      window.dispatchEvent(new StorageEvent("storage", {
        key: SELECTED_ORGANIZATION_KEY,
        oldValue: "org-a",
        newValue: "org-b",
      }));
    });
    expect(result.current.organizationId).toBe("org-b");
    expect(result.current.products).not.toBe("org-a");
    await waitFor(() => expect(result.current.products).toBe("org-b"));
    expect(load).toHaveBeenCalledTimes(1);
    unmount();
  } finally {
    queryClient.clear();
    storage.removeItem(SELECTED_ORGANIZATION_KEY);
  }
});

it("binds the POS context read, the direct sale and the financing to the rendered identity", async () => {
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValue({ data: { locations: [], checkoutLocationId: null } } as never);
  const post = vi
    .spyOn(api, "post")
    .mockResolvedValue({ data: { id: "request-1" } } as never);
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  try {
    const { result } = renderHook(
      () => ({
        context: scopeHooks.usePosSiteContext("user-a", "org-a"),
        sale: useCreateSale({ userId: "user-a", organizationId: "org-a" }),
        loan: useCreatePosLoan({ userId: "user-a", organizationId: "org-a" }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith(
      "/locations/pos-context",
      undefined,
      { signal: expect.any(AbortSignal), posScope: { userId: "user-a", organizationId: "org-a" } },
    );

    await act(async () => {
      await result.current.sale.mutateAsync({
        items: [{ productId: "product-1", quantity: 1, discountAmount: 0 }],
        payments: [{ method: "CASH", amount: 1000 }],
      });
      await result.current.loan.mutateAsync({
        customerId: "customer-1",
        reason: "Venta financiada",
        items: [{ productId: "product-1", quantity: 1 }],
        requestKey: "attempt-key",
      });
    });

    expect(post).toHaveBeenCalledWith("/sales", expect.anything(), {
      posScope: { userId: "user-a", organizationId: "org-a" },
    });
    expect(post).toHaveBeenCalledWith(
      "/loans/pos-initiation",
      expect.objectContaining({ requestKey: "attempt-key" }),
      { posScope: { userId: "user-a", organizationId: "org-a" } },
    );
  } finally {
    get.mockRestore();
    post.mockRestore();
    queryClient.clear();
  }
});
