import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { api } from "@/lib/api";
import { useCreateUser } from "./useUsers";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

let client: QueryClient;

function response(data: unknown): AxiosResponse {
  return {
    data,
    status: 201,
    statusText: "Created",
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
  vi.mocked(api.post).mockResolvedValue(
    response({ id: "user-member", name: "Miembro Uno", email: "miembro@example.com" }),
  );
});

afterEach(cleanup);

describe("user API hooks", () => {
  it("forwards an INVENTORY_USER role from the team screen unchanged", async () => {
    // The team screen hands out exactly the current OrgRole values, so the
    // payload carries the chosen one verbatim instead of narrowing it away.
    client.setQueryData(["users"], []);
    const { result } = renderHook(() => useCreateUser(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Miembro Uno",
        email: "miembro@example.com",
        password: "ClaveSegura123",
        role: "INVENTORY_USER",
      });
    });

    expect(api.post).toHaveBeenCalledWith("/users", {
      name: "Miembro Uno",
      email: "miembro@example.com",
      password: "ClaveSegura123",
      role: "INVENTORY_USER",
    });
    expect(client.getQueryState(["users"])?.isInvalidated).toBe(true);
  });
});
