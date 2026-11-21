import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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

    await waitFor(() => expect(result.current.alerts).toEqual([alert]));
    expect(api.get).toHaveBeenCalledWith("/alerts");
  });

  it("reports the failure instead of pretending the feed is empty", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useAlerts(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.alerts).toEqual([]);
  });

  it("stays error-free while the feed is still loading", async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAlerts(), { wrapper });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(result.current.isError).toBe(false);
    expect(result.current.alerts).toEqual([]);
  });

  it("re-asks the backend when the caller retries", async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(respond([alert]));

    const { result } = renderHook(() => useAlerts(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.alerts).toEqual([alert]));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("returns each alert with its revision", async () => {
    vi.mocked(api.get).mockResolvedValue(respond([alert]));

    const { result } = renderHook(() => useAlerts(), { wrapper });

    await waitFor(() =>
      expect(result.current.alerts[0]?.revision).toBe("abc123"),
    );
  });

  it("does not ask for a feed without an organization scope", async () => {
    authState.current = { user: { organizationId: undefined } };

    const { result } = renderHook(() => useAlerts(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.get).not.toHaveBeenCalled();
    // A disabled query is not a failure: the bell shows the empty state.
    expect(result.current.alerts).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it("keys the cache by organization so a switch cannot serve the previous tenant", async () => {
    vi.mocked(api.get).mockResolvedValue(respond([alert]));

    const { result, rerender } = renderHook(() => useAlerts(), { wrapper });
    await waitFor(() => expect(result.current.alerts).toEqual([alert]));

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
