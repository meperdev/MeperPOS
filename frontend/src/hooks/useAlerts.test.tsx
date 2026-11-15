import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));

const authState = vi.hoisted(() => ({
  current: { user: { organizationId: "org-1" } } as {
    user: { organizationId?: string | null };
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState.current }));

import { api } from "@/lib/api";
import { useAlerts, type AppAlert } from "./useAlerts";

const alert: AppAlert = {
  id: "stock:low",
  category: "stock",
  severity: "warning",
  title: "Stock bajo",
  detail: "2 productos por debajo del mínimo.",
  href: "/inventory?filter=lowStock",
  revision: "abc123",
};

/** A response envelope is all the hook reads from the axios instance. */
const respond = (data: AppAlert[]) =>
  ({ data }) as unknown as Awaited<ReturnType<typeof api.get>>;

let client: QueryClient;
let wrapper: ({ children }: { children: React.ReactNode }) => React.ReactElement;

describe("useAlerts", () => {
  beforeEach(() => {
    authState.current = { user: { organizationId: "org-1" } };
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(api.get).mockReset();
  });

  afterEach(() => cleanup());

  it("asks the backend for the organization feed", async () => {
    vi.mocked(api.get).mockResolvedValue(respond([alert]));

    const { result } = renderHook(() => useAlerts(), { wrapper });

    await waitFor(() => expect(result.current).toEqual([alert]));
    expect(api.get).toHaveBeenCalledWith("/alerts");
  });

  it("returns an empty list instead of throwing when the feed fails", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useAlerts(), { wrapper });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("returns each alert with its revision", async () => {
    vi.mocked(api.get).mockResolvedValue(respond([alert]));

    const { result } = renderHook(() => useAlerts(), { wrapper });

    await waitFor(() => expect(result.current[0]?.revision).toBe("abc123"));
  });

  it("does not ask for a feed without an organization scope", async () => {
    authState.current = { user: { organizationId: undefined } };

    const { result } = renderHook(() => useAlerts(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.get).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it("keys the cache by organization so a switch cannot serve the previous tenant", async () => {
    vi.mocked(api.get).mockResolvedValue(respond([alert]));

    const { result, rerender } = renderHook(() => useAlerts(), { wrapper });
    await waitFor(() => expect(result.current).toEqual([alert]));

    authState.current = { user: { organizationId: "org-2" } };
    rerender();

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect([...client.getQueryCache().getAll()].map((query) => query.queryKey)).toEqual(
      expect.arrayContaining([
        ["alerts", "org-1"],
        ["alerts", "org-2"],
      ]),
    );
  });
});
