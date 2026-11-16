import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { DailyReport } from "@/types";
import { useDailyReport } from "./useDailyReport";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));

const apiMock = api as unknown as { get: ReturnType<typeof vi.fn> };

const report: DailyReport = {
  cutoff: "2026-03-15T18:42:00.000Z",
  date: "2026-03-15",
  timezone: "America/Bogota",
  salesTotal: "120000.00",
  expenseTotal: "30000.00",
  sales: [],
  expenses: [],
  lowStock: [],
  purchaseOrders: [],
  loans: [],
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe("useDailyReport", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
  });

  it("reads the always-today daily report without a date range", async () => {
    apiMock.get.mockResolvedValue({ data: report });

    const { result } = renderHook(() => useDailyReport(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(report));
    expect(apiMock.get).toHaveBeenCalledWith("/reports/daily-report");
  });
});
