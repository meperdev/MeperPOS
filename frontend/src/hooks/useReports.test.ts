import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { UserPerformanceReport } from "@/types";
import { useUserPerformance } from "./useReports";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));

const apiMock = api as unknown as { get: ReturnType<typeof vi.fn> };

const report: UserPerformanceReport = {
  data: [
    {
      userId: "u-1",
      userName: "Ana",
      salesCount: 3,
      revenue: 180000,
      avgTicket: 60000,
      uniqueCustomers: 2,
    },
  ],
  appliedRange: { startDate: "2026-03-01", endDate: "2026-03-15", timezone: "America/Bogota" },
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

describe("useUserPerformance", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
  });

  it("asks for the same explicit period as the rest of the page, without a comparison run", async () => {
    apiMock.get.mockResolvedValue({ data: report });

    const { result } = renderHook(() => useUserPerformance("2026-03-01", "2026-03-15"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual(report));
    expect(apiMock.get).toHaveBeenCalledWith("/reports/users/performance", {
      startDate: "2026-03-01",
      endDate: "2026-03-15",
      compare: "false",
    });
  });

  it("stays idle until the period has both ends", () => {
    apiMock.get.mockResolvedValue({ data: report });

    renderHook(() => useUserPerformance("", ""), { wrapper });

    expect(apiMock.get).not.toHaveBeenCalled();
  });
});
