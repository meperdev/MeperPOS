import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { api } from "@/lib/api";
import { useModuleCatalog, useUpdateOrganizationModule } from "./useAdmin";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.mocked(api.get).mockResolvedValue(response([]));
  vi.mocked(api.patch).mockResolvedValue(response({}));
});

afterEach(cleanup);

describe("admin module hooks", () => {
  it("reads the server module catalog from GET /admin/modules", async () => {
    const catalog = [
      {
        id: "vehicles",
        name: "Vehículos",
        description: "Placas, modelos y vehículos asociados a cada cliente.",
      },
    ];
    vi.mocked(api.get).mockResolvedValue(response(catalog));

    const { result } = renderHook(() => useModuleCatalog(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/admin/modules");
    expect(result.current.data).toEqual(catalog);
    expect(client.getQueryData(["admin", "modules"])).toEqual(catalog);
  });

  it("keeps the module toggle endpoint and invalidates the organization list", async () => {
    client.setQueryData(["admin", "organizations"], [
      { id: "org-1", enabledModules: ["vehicles"] },
    ]);
    client.setQueryData(["admin", "organization", "org-1", "modules"], []);
    client.setQueryData(["business-modules", "org-1"], []);
    client.setQueryData(["customer-vehicles"], []);
    client.setQueryData(["customers"], []);

    const { result } = renderHook(() => useUpdateOrganizationModule(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: "org-1",
        moduleId: "vehicles",
        enabled: false,
      });
    });

    expect(api.patch).toHaveBeenCalledWith(
      "/admin/organizations/org-1/modules/vehicles",
      { enabled: false },
    );
    expect(
      client.getQueryState(["admin", "organizations"])?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["admin", "organization", "org-1", "modules"])
        ?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(["business-modules", "org-1"])?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(["customer-vehicles"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["customers"])?.isInvalidated).toBe(true);
  });
});
