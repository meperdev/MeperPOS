import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { api } from "@/lib/api";
import {
  useCreateLocation,
  useLocations,
  useReplaceLocationAssignments,
  useUpdateLocation,
  useUserLocationAssignments,
} from "./useLocations";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  vi.mocked(api.get).mockResolvedValue(response([]));
  vi.mocked(api.post).mockResolvedValue(response({ id: "new" }));
  vi.mocked(api.patch).mockResolvedValue(response({ id: "a" }));
  vi.mocked(api.put).mockResolvedValue(response({ locationIds: [] }));
});

afterEach(cleanup);

describe("location API hooks", () => {
  it("reads the accessible sites of the active organization", async () => {
    vi.mocked(api.get).mockResolvedValue(
      response([{ id: "a", name: "Principal", type: "STORE", isDefault: true }]),
    );
    const { result } = renderHook(() => useLocations(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/locations");
    expect(result.current.data).toEqual([
      { id: "a", name: "Principal", type: "STORE", isDefault: true },
    ]);
  });

  it("creates a site and refreshes both the directory and the POS context", async () => {
    client.setQueryData(["locations"], [{ id: "old" }]);
    client.setQueryData(["pos-site-context", "user", "org"], {
      locations: [],
      checkoutLocationId: null,
    });
    const { result } = renderHook(() => useCreateLocation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "Bodega norte", type: "WAREHOUSE" });
    });

    expect(api.post).toHaveBeenCalledWith("/locations", {
      name: "Bodega norte",
      type: "WAREHOUSE",
    });
    expect(client.getQueryState(["locations"])?.isInvalidated).toBe(true);
    expect(
      client.getQueryState(["pos-site-context", "user", "org"])?.isInvalidated,
    ).toBe(true);
  });

  it("renames or retypes one site and refreshes the POS context", async () => {
    client.setQueryData(["locations"], [{ id: "old" }]);
    client.setQueryData(["pos-site-context", "user", "org"], {
      locations: [],
      checkoutLocationId: null,
    });
    const { result } = renderHook(() => useUpdateLocation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "a/b",
        data: { name: "Bodega sur", type: "STORE" },
      });
    });

    expect(api.patch).toHaveBeenCalledWith("/locations/a%2Fb", {
      name: "Bodega sur",
      type: "STORE",
    });
    expect(client.getQueryState(["locations"])?.isInvalidated).toBe(true);
    expect(
      client.getQueryState(["pos-site-context", "user", "org"])?.isInvalidated,
    ).toBe(true);
  });

  it("reads a membership's explicit assignments only when a user is given", async () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useUserLocationAssignments(userId),
      { wrapper, initialProps: { userId: null as string | null } },
    );

    expect(api.get).not.toHaveBeenCalled();

    vi.mocked(api.get).mockResolvedValue(
      response({ locationIds: ["a"], orgWideAccess: false }),
    );
    rerender({ userId: "user-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/users/user-1/locations");
    expect(result.current.data).toEqual({
      locationIds: ["a"],
      orgWideAccess: false,
    });
  });

  it("replaces assignments and refreshes the directory, the assignment and the POS context", async () => {
    client.setQueryData(["locations"], [{ id: "old" }]);
    client.setQueryData(["user-locations", "user-1"], { locationIds: [] });
    client.setQueryData(["pos-site-context", "user", "org"], {
      locations: [],
      checkoutLocationId: null,
    });
    const { result } = renderHook(() => useReplaceLocationAssignments(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        userId: "user-1",
        locationIds: ["b", "a"],
      });
    });

    expect(api.put).toHaveBeenCalledWith("/users/user-1/locations", {
      locationIds: ["b", "a"],
    });
    expect(client.getQueryState(["locations"])?.isInvalidated).toBe(true);
    expect(
      client.getQueryState(["user-locations", "user-1"])?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["pos-site-context", "user", "org"])?.isInvalidated,
    ).toBe(true);
  });

  it("does not refresh any cache when the server rejects the change", async () => {
    client.setQueryData(["locations"], [{ id: "old" }]);
    vi.mocked(api.post).mockRejectedValue(new Error("failed"));
    const { result } = renderHook(() => useCreateLocation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: "Bodega norte", type: "WAREHOUSE" }),
      ).rejects.toThrow("failed");
    });

    expect(client.getQueryState(["locations"])?.isInvalidated).toBe(false);
  });
});
