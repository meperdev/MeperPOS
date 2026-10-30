import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AxiosHeaders, type AxiosResponse } from "axios";
import {
  useCreatePayrollGroup,
  useCreatePayrollGroupInstallment,
  useCreatePayrollPeriod,
  useCreatePayrollPeriodInstallment,
  usePayrollObligations,
} from "./usePayroll";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

// The only payloads the routes accept: date-only strings, decimal amounts as
// strings and the per-payment expense choice. The hook must not reshape them.
const OBLIGATIONS_KEY = ["payroll-obligations"];

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
  vi.mocked(api.post).mockResolvedValue(response({ id: "obligation" }));
});

afterEach(cleanup);

it("reads obligations from the server route only when enabled", async () => {
  const { result, rerender } = renderHook(({ enabled }) => usePayrollObligations(enabled), {
    wrapper,
    initialProps: { enabled: false },
  });
  expect(api.get).not.toHaveBeenCalled();

  rerender({ enabled: true });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api.get).toHaveBeenCalledWith("/payroll/obligations");
});

it("posts the fixed-period payment unchanged and refreshes the obligation list", async () => {
  client.setQueryData(OBLIGATIONS_KEY, []);
  const { result } = renderHook(() => useCreatePayrollPeriod(), { wrapper });
  const data = {
    employeeId: "emp-1",
    periodStart: "2025-01-01",
    periodEnd: "2025-01-31",
    periodAmount: "1500000.50",
    expenseEnabled: true,
    selectedExpenseDate: "2025-02-01",
  };

  await act(async () => {
    await result.current.mutateAsync(data);
  });

  expect(api.post).toHaveBeenCalledWith("/payroll/periods", data);
  expect(client.getQueryState(OBLIGATIONS_KEY)?.isInvalidated).toBe(true);
});

it("posts the shift-group payment with every selected shift and refreshes the obligation list", async () => {
  client.setQueryData(OBLIGATIONS_KEY, []);
  const { result } = renderHook(() => useCreatePayrollGroup(), { wrapper });
  const data = { employeeId: "emp-1", shiftIds: ["shift-1", "shift-2"], expenseEnabled: false };

  await act(async () => {
    await result.current.mutateAsync(data);
  });

  expect(api.post).toHaveBeenCalledWith("/payroll/groups", data);
  expect(client.getQueryState(OBLIGATIONS_KEY)?.isInvalidated).toBe(true);
});

it("routes each installment to the endpoint that matches its obligation kind", async () => {
  client.setQueryData(OBLIGATIONS_KEY, []);
  const period = renderHook(() => useCreatePayrollPeriodInstallment(), { wrapper });
  const group = renderHook(() => useCreatePayrollGroupInstallment(), { wrapper });
  const periodData = {
    employeeId: "emp-1",
    obligationId: "period-1",
    amount: "500000.00",
    date: "2025-01-15",
    method: "CASH" as const,
  };
  const groupData = {
    employeeId: "emp-1",
    obligationId: "group-1",
    amount: "100000.00",
    date: "2025-01-16",
    method: "TRANSFER" as const,
  };

  await act(async () => {
    await period.result.current.mutateAsync(periodData);
  });
  await act(async () => {
    await group.result.current.mutateAsync(groupData);
  });

  expect(api.post).toHaveBeenCalledWith("/payroll/period-installments", periodData);
  expect(api.post).toHaveBeenCalledWith("/payroll/group-installments", groupData);
  expect(client.getQueryState(OBLIGATIONS_KEY)?.isInvalidated).toBe(true);
});

it("does not refresh the obligation list when a payment fails", async () => {
  client.setQueryData(OBLIGATIONS_KEY, []);
  vi.mocked(api.post).mockRejectedValue(new Error("conflict"));
  const { result } = renderHook(() => useCreatePayrollGroup(), { wrapper });

  await act(async () => {
    await expect(
      result.current.mutateAsync({ employeeId: "emp-1", shiftIds: ["shift-1"], expenseEnabled: false }),
    ).rejects.toThrow("conflict");
  });

  expect(client.getQueryState(OBLIGATIONS_KEY)?.isInvalidated).toBe(false);
});
