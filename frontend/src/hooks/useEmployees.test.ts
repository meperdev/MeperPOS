import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { useCreateEmployee, useEmployees, useSetEmployeeActive, useUpdateEmployee, type EmployeePayload } from "./useEmployees";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const payload: EmployeePayload = { name: "Ana", identification: null, phone: null, email: null, address: null, jobTitle: null, startDate: null, remunerationModality: null, referenceAmount: null };
let client: QueryClient;
function response(data: unknown): AxiosResponse {
  return { data, status: 200, statusText: "OK", headers: {}, config: { headers: new AxiosHeaders() } };
}
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.mocked(api.get).mockResolvedValue(response([]));
  vi.mocked(api.post).mockResolvedValue(response({ id: "1" }));
  vi.mocked(api.patch).mockResolvedValue(response({ id: "1" }));
});
afterEach(cleanup);

describe("employee API hooks", () => {
  it("only loads the employee list when enabled", async () => {
    const { result, rerender } = renderHook(({ enabled }) => useEmployees(enabled), { wrapper, initialProps: { enabled: false } });
    expect(api.get).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/employees");
    expect(result.current.data).toEqual([]);
  });
  it("posts nullable profile values and invalidates the employee list", async () => {
    client.setQueryData(["employees"], [{ id: "old" }]);
    const { result } = renderHook(() => useCreateEmployee(), { wrapper });
    await act(async () => { await result.current.mutateAsync(payload); });
    expect(api.post).toHaveBeenCalledWith("/employees", payload);
    expect(client.getQueryState(["employees"])?.isInvalidated).toBe(true);
  });
  it("patches explicit nulls to clear optional fields and invalidates the list", async () => {
    client.setQueryData(["employees"], [{ id: "old" }]);
    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: "a/b", data: payload }); });
    expect(api.patch).toHaveBeenCalledWith("/employees/a%2Fb", payload);
    expect(client.getQueryState(["employees"])?.isInvalidated).toBe(true);
  });
  it.each([true, false])("patches activation to %s and invalidates the list", async (active) => {
    client.setQueryData(["employees"], [{ id: "old" }]);
    const { result } = renderHook(() => useSetEmployeeActive(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: "1", active }); });
    expect(api.patch).toHaveBeenCalledWith("/employees/1/active", { active });
    expect(client.getQueryState(["employees"])?.isInvalidated).toBe(true);
  });
  it("does not invalidate on a rejected update", async () => {
    client.setQueryData(["employees"], [{ id: "old" }]);
    vi.mocked(api.patch).mockRejectedValue(new Error("failed"));
    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ id: "1", data: payload })).rejects.toThrow("failed"); });
    expect(client.getQueryState(["employees"])?.isInvalidated).toBe(false);
  });
});
