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
import { useAlertNotifications } from "./useAlertNotifications";

const page = {
  data: [
    {
      id: "e1",
      product: { id: "p1", name: "Café", sku: "BEB-003" },
      episode: 1,
      kind: "NOTIFIED" as const,
      failureReason: null,
      createdAt: "2026-11-15T10:00:00.000Z",
    },
  ],
  meta: { total: 1, page: 2, limit: 20, totalPages: 1 },
};

const respond = (data: typeof page) =>
  ({ data }) as unknown as Awaited<ReturnType<typeof api.get>>;

let client: QueryClient;
let wrapper: ({ children }: { children: React.ReactNode }) => React.ReactElement;

describe("useAlertNotifications", () => {
  beforeEach(() => {
    authState.current = { user: { organizationId: "org-1" } };
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(api.get).mockReset();
  });

  afterEach(() => cleanup());

  it("sends page, limit and kind as query params", async () => {
    vi.mocked(api.get).mockResolvedValue(respond(page));

    const { result } = renderHook(
      () =>
        useAlertNotifications({ page: 2, limit: 20, kind: "FAILED" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toEqual(page));
    expect(api.get).toHaveBeenCalledWith(
      "/alerts/notifications?page=2&limit=20&kind=FAILED",
    );
  });

  it("omits the kind filter when none is selected", async () => {
    vi.mocked(api.get).mockResolvedValue(respond(page));

    renderHook(() => useAlertNotifications({ page: 1, limit: 20 }), {
      wrapper,
    });

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/alerts/notifications?page=1&limit=20",
      ),
    );
  });

  it("refetches when the page changes", async () => {
    vi.mocked(api.get).mockResolvedValue(respond(page));

    const { rerender } = renderHook(
      ({ page: current }: { page: number }) =>
        useAlertNotifications({ page: current, limit: 20 }),
      { wrapper, initialProps: { page: 1 } },
    );

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    rerender({ page: 2 });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(api.get).toHaveBeenLastCalledWith(
      "/alerts/notifications?page=2&limit=20",
    );
  });

  it("does not ask for history without an organization scope", async () => {
    authState.current = { user: { organizationId: undefined } };

    renderHook(() => useAlertNotifications({ page: 1, limit: 20 }), {
      wrapper,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.get).not.toHaveBeenCalled();
  });

  it("keys the cache by organization so a switch cannot serve another tenant", async () => {
    vi.mocked(api.get).mockResolvedValue(respond(page));

    const { rerender } = renderHook(
      () => useAlertNotifications({ page: 1, limit: 20 }),
      { wrapper },
    );
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    authState.current = { user: { organizationId: "org-2" } };
    rerender();

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(
      [...client.getQueryCache().getAll()].map((query) => query.queryKey),
    ).toEqual(
      expect.arrayContaining([
        ["alerts", "notifications", "org-1", { page: 1, limit: 20 }],
        ["alerts", "notifications", "org-2", { page: 1, limit: 20 }],
      ]),
    );
  });
});
