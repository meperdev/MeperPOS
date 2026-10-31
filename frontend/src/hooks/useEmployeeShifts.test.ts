import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { useCreateEmployeeShift, useEmployeeShifts } from "./useEmployeeShifts";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let client: QueryClient;
function response(data: unknown): AxiosResponse { return { data, status: 200, statusText: "OK", headers: {}, config: { headers: new AxiosHeaders() } }; }
function wrapper({ children }: { children: ReactNode }) { return createElement(QueryClientProvider, { client }, children); }
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); vi.mocked(api.get).mockResolvedValue(response([])); vi.mocked(api.post).mockResolvedValue(response({ id: "s" })); });
afterEach(cleanup);
it("loads only when enabled and encodes the employee id", async () => {
  const { result, rerender } = renderHook(({ enabled }) => useEmployeeShifts("a/b", enabled), { wrapper, initialProps: { enabled: false } });
  expect(api.get).not.toHaveBeenCalled(); rerender({ enabled: true });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api.get).toHaveBeenCalledWith("/employees/a%2Fb/shifts");
});
it("posts the wired contract and invalidates only that employee history", async () => {
  client.setQueryData(["employee-shifts", "a"], []); client.setQueryData(["employee-shifts", "b"], []);
  const { result } = renderHook(() => useCreateEmployeeShift(), { wrapper });
  const data = { employeeId: "a", date: "2025-01-02", kind: "PARTIAL_DAY" as const, amount: 10.25, observation: "Nota" };
  await act(async () => { await result.current.mutateAsync(data); });
  expect(api.post).toHaveBeenCalledWith("/employees/shifts", data);
  expect(client.getQueryState(["employee-shifts", "a"])?.isInvalidated).toBe(true);
  expect(client.getQueryState(["employee-shifts", "b"])?.isInvalidated).toBe(false);
});
it("does not invalidate on failure", async () => {
  client.setQueryData(["employee-shifts", "a"], []); vi.mocked(api.post).mockRejectedValue(new Error("conflict"));
  const { result } = renderHook(() => useCreateEmployeeShift(), { wrapper });
  await act(async () => { await expect(result.current.mutateAsync({ employeeId: "a", date: "2025-01-02", kind: "FULL_DAY", amount: 1 })).rejects.toThrow("conflict"); });
  expect(client.getQueryState(["employee-shifts", "a"])?.isInvalidated).toBe(false);
});
