import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getBlob: vi.fn(),
    saveBlob: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import { useReceivePurchaseOrder, useSendPurchaseOrder } from "./usePurchaseOrders";

/** A response envelope is all the hook reads from the axios instance. */
const respond = (data: unknown) =>
  ({ data }) as unknown as Awaited<ReturnType<typeof api.post>>;

let client: QueryClient;
let wrapper: ({ children }: { children: React.ReactNode }) => React.ReactElement;

describe("useSendPurchaseOrder", () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue(respond({ id: "po-1" }));
  });

  afterEach(() => cleanup());

  it("sends the expected delivery date with the first send", async () => {
    const { result } = renderHook(() => useSendPurchaseOrder(), { wrapper });

    await result.current.mutateAsync({
      id: "po-1",
      expectedDeliveryDate: "2026-12-01",
    });

    expect(api.post).toHaveBeenCalledWith("/purchase-orders/po-1/send", {
      expectedDeliveryDate: "2026-12-01",
    });
  });

  it("posts an empty body when no date is chosen", async () => {
    const { result } = renderHook(() => useSendPurchaseOrder(), { wrapper });

    await result.current.mutateAsync({ id: "po-1" });

    expect(api.post).toHaveBeenCalledWith("/purchase-orders/po-1/send", {});
  });

  it("refetches the order so the modal reopens on the saved date", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSendPurchaseOrder(), { wrapper });

    await result.current.mutateAsync({ id: "po-1" });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["purchase-order", "po-1"],
    });
  });
});

describe("useReceivePurchaseOrder", () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue(respond({ id: "po-1" }));
  });

  afterEach(() => cleanup());

  it("leaves the default receipt request byte-identical", async () => {
    const { result } = renderHook(() => useReceivePurchaseOrder(), { wrapper });

    await result.current.mutateAsync({
      id: "po-1",
      items: [{ itemId: "poi-1", qtyReceivedNow: 2 }],
    });

    expect(api.post).toHaveBeenCalledWith("/purchase-orders/po-1/receive", {
      items: [{ itemId: "poi-1", qtyReceivedNow: 2 }],
    });
    // The principal site is the server's default: no `locationId` travels.
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("locationId");
  });

  it("sends the destination site the user chose", async () => {
    const { result } = renderHook(() => useReceivePurchaseOrder(), { wrapper });

    await result.current.mutateAsync({
      id: "po-1",
      locationId: "site-b",
      items: [{ itemId: "poi-1", qtyReceivedNow: 2 }],
    });

    expect(api.post).toHaveBeenCalledWith("/purchase-orders/po-1/receive", {
      items: [{ itemId: "poi-1", qtyReceivedNow: 2 }],
      locationId: "site-b",
    });
  });
});
