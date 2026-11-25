import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { api } from "@/lib/api";
import {
  useCancelTransfer,
  useCreateTransfer,
  useReceiveTransfer,
  useTransfer,
  useTransferSummary,
  useTransfers,
} from "./useTransfers";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

let client: QueryClient;

function response(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

const transfer = {
  id: "transfer-1",
  number: 7,
  organizationId: "org-a",
  status: "IN_TRANSIT",
  fromLocationId: "site-a",
  toLocationId: "site-b",
  fromLocation: { id: "site-a", name: "Sede centro", type: "STORE" },
  toLocation: { id: "site-b", name: "Bodega norte", type: "WAREHOUSE" },
  notes: null,
  createdById: "user-1",
  createdAt: "2026-11-25T14:00:00.000Z",
  receivedAt: null,
  receivedById: null,
  cancelledAt: null,
  cancelledById: null,
  cancelReason: null,
  items: [{ id: "item-1", productId: "prod-1", quantity: 3 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  vi.mocked(api.get).mockResolvedValue(response({ data: [], meta: {} }));
  vi.mocked(api.post).mockResolvedValue(response(transfer));
});

afterEach(cleanup);

describe("transfer API hooks", () => {
  it("reads the paginated list with its status and site filters", async () => {
    const page = {
      data: [transfer],
      meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
    };
    vi.mocked(api.get).mockResolvedValue(response(page));
    const { result } = renderHook(
      () => useTransfers({ status: "IN_TRANSIT", siteId: "site-a", page: 1 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/transfers", {
      status: "IN_TRANSIT",
      siteId: "site-a",
      page: 1,
    });
    expect(result.current.data).toEqual(page);
  });

  it("does not read a detail without an identifier", () => {
    renderHook(() => useTransfer(""), { wrapper });

    expect(api.get).not.toHaveBeenCalled();
  });

  it("dispatches a trimmed note and the lines, and refreshes the drifted caches", async () => {
    client.setQueryData(["transfers", undefined], { data: [], meta: {} });
    client.setQueryData(["products", {}], { data: [] });
    client.setQueryData(["inventory-movements", {}], { data: [] });
    const { result } = renderHook(() => useCreateTransfer(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        fromLocationId: "site-a",
        toLocationId: "site-b",
        notes: "  Traslado a la bodega  ",
        items: [{ productId: "prod-1", quantity: 3 }],
      });
    });

    expect(api.post).toHaveBeenCalledWith("/transfers", {
      fromLocationId: "site-a",
      toLocationId: "site-b",
      notes: "Traslado a la bodega",
      items: [{ productId: "prod-1", quantity: 3 }],
    });
    expect(client.getQueryState(["transfers", undefined])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["products", {}])?.isInvalidated).toBe(true);
    expect(
      client.getQueryState(["inventory-movements", {}])?.isInvalidated,
    ).toBe(true);
  });

  it("omits an empty note instead of storing one", async () => {
    const { result } = renderHook(() => useCreateTransfer(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        fromLocationId: "site-a",
        toLocationId: "site-b",
        notes: "   ",
        items: [{ productId: "prod-1", quantity: 1 }],
      });
    });

    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("notes");
    expect(body).toMatchObject({
      fromLocationId: "site-a",
      toLocationId: "site-b",
    });
  });

  it("receives a transfer and refreshes its list and its own detail", async () => {
    client.setQueryData(["transfers", undefined], { data: [], meta: {} });
    client.setQueryData(["transfer", "transfer-1"], transfer);
    const { result } = renderHook(() => useReceiveTransfer(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "transfer-1" });
    });

    expect(api.post).toHaveBeenCalledWith("/transfers/transfer-1/receive");
    expect(client.getQueryState(["transfers", undefined])?.isInvalidated).toBe(true);
    expect(
      client.getQueryState(["transfer", "transfer-1"])?.isInvalidated,
    ).toBe(true);
  });

  it("cancels with its mandatory reason", async () => {
    const { result } = renderHook(() => useCancelTransfer(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "transfer-1",
        reason: "La bodega no la recibe",
      });
    });

    expect(api.post).toHaveBeenCalledWith("/transfers/transfer-1/cancel", {
      reason: "La bodega no la recibe",
    });
  });

  it("does not refresh any cache when the server rejects the dispatch", async () => {
    client.setQueryData(["transfers", undefined], { data: [], meta: {} });
    vi.mocked(api.post).mockRejectedValue(new Error("conflict"));
    const { result } = renderHook(() => useCreateTransfer(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          fromLocationId: "site-a",
          toLocationId: "site-b",
          items: [{ productId: "prod-1", quantity: 3 }],
        }),
      ).rejects.toThrow("conflict");
    });

    expect(client.getQueryState(["transfers", undefined])?.isInvalidated).toBe(
      false,
    );
  });
});

describe("transfer summary", () => {
  /** One server total per state, as `meta.total` reports it. */
  function totalsByStatus() {
    const totals: Record<string, number> = {
      IN_TRANSIT: 4,
      RECEIVED: 12,
      CANCELLED: 2,
    };
    vi.mocked(api.get).mockImplementation((_url, config) => {
      const params = (config ?? {}) as { status?: string };
      return Promise.resolve(
        response({
          data: [],
          meta: {
            total: totals[params.status ?? ""] ?? 0,
            page: 1,
            limit: 1,
            totalPages: 1,
          },
        }),
      );
    });
  }

  it("reads one count per state for the current site scope", async () => {
    totalsByStatus();
    const { result } = renderHook(() => useTransferSummary("site-a"), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.data).toEqual({
        inTransit: 4,
        received: 12,
        cancelled: 2,
      }),
    );
    expect(api.get).toHaveBeenCalledWith("/transfers", {
      status: "IN_TRANSIT",
      limit: 1,
      siteId: "site-a",
    });
    expect(api.get).toHaveBeenCalledWith("/transfers", {
      status: "RECEIVED",
      limit: 1,
      siteId: "site-a",
    });
    expect(api.get).toHaveBeenCalledWith("/transfers", {
      status: "CANCELLED",
      limit: 1,
      siteId: "site-a",
    });
  });

  it("asks for every site when no site is chosen", async () => {
    totalsByStatus();
    renderHook(() => useTransferSummary(), { wrapper });

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/transfers", {
        status: "IN_TRANSIT",
        limit: 1,
      }),
    );
  });

  it("counts nothing until every state has answered", async () => {
    vi.mocked(api.get).mockImplementation((_url, config) => {
      const params = (config ?? {}) as { status?: string };
      if (params.status === "CANCELLED") return new Promise(() => {});
      return Promise.resolve(
        response({
          data: [],
          meta: { total: 1, page: 1, limit: 1, totalPages: 1 },
        }),
      );
    });
    const { result } = renderHook(() => useTransferSummary(), { wrapper });

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
    expect(result.current.data).toBeUndefined();
  });
});
