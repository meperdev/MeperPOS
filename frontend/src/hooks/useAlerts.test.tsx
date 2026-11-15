import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));

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

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A response envelope is all the hook reads from the axios instance. */
const respond = (data: AppAlert[]) =>
  ({ data }) as unknown as Awaited<ReturnType<typeof api.get>>;

describe("useAlerts", () => {
  beforeEach(() => {
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
});
