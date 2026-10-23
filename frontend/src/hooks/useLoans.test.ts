import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { api } from "@/lib/api";
import type {
  CreatePosLoanInput,
  Loan,
  LoanHistoryEvent,
  LoanOperationResult,
  LoanPage,
  PosLoanInitiation,
} from "@/types";
import {
  useCollectLoan,
  useCompletePosLoan,
  useCreatePosLoan,
  useLoan,
  useLoanHistory,
  useLoans,
} from "./useLoans";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const apiMock = api as unknown as { post: ReturnType<typeof vi.fn> };
const apiGetMock = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

const initiation: PosLoanInitiation = {
  intentId: "intent-1",
  loanId: "loan-1",
  organizationId: "org-1",
  customerId: "customer-1",
  agreedCustomerTotal: "12345.00",
  quoteSnapshot: {},
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** A wrapper around a caller-owned client, so invalidation can be observed. */
function wrapperWith(client: QueryClient) {
  return function withClient({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const loan: Loan = {
  type: "MONEY",
  id: "loan-1",
  amount: "12345.00",
  status: "OPEN",
  issuedAt: "2026-08-01T00:00:00.000Z",
  dueAt: null,
  reason: "Venta financiada",
  customerId: "customer-1",
  supplierId: null,
  employeeId: null,
  createdById: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  customer: { id: "customer-1", name: "Ana Perez" },
  supplier: null,
  employee: null,
  createdBy: { id: "user-1", name: "Vendedor" },
  collected: "0.00",
  balance: "12345.00",
  paymentStatus: "UNPAID",
  posFinancing: null,
};

const historyEvent: LoanHistoryEvent = {
  id: "event-1",
  loanId: "loan-1",
  type: "COLLECTED",
  amount: "1000.00",
  method: "CASH",
  reversesId: null,
  reason: "Abono recibido",
  createdById: "user-1",
  createdAt: "2026-08-02T00:00:00.000Z",
  createdBy: { id: "user-1", name: "Vendedor" },
};

const collectResult: LoanOperationResult = {
  type: "MONEY",
  loanId: "loan-1",
  status: "OPEN",
  collected: "1000.00",
  balance: "11345.00",
  paymentStatus: "PARTIAL",
  eventId: "event-1",
};

const completionResult: LoanOperationResult = {
  type: "MONEY",
  loanId: "loan-1",
  intentId: "intent-1",
  saleId: "sale-1",
  status: "CLOSED",
  collected: "12345.00",
  balance: "0.00",
  paymentStatus: "PAID",
  eventId: "event-2",
};

function baseInput(
  overrides: Partial<CreatePosLoanInput> = {},
): CreatePosLoanInput {
  return {
    customerId: "customer-1",
    reason: "Venta financiada",
    items: [{ productId: "product-1", quantity: 2 }],
    ...overrides,
  };
}

/** The body sent on the first POST to /loans/pos-initiation. */
function postedBody() {
  return apiMock.post.mock.calls[0]?.[1] as {
    requestKey?: string;
    issuedAt?: string;
    reason?: string;
    customerId?: string;
    discountAmount?: number;
    items: Array<Record<string, unknown>>;
  };
}

/** The body sent on the first POST of a mutation under test. */
function postedMutationBody() {
  return apiMock.post.mock.calls[0]?.[1] as Record<string, unknown> & { requestKey: string };
}

describe("useCreatePosLoan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.post.mockResolvedValue({ data: initiation });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the initiation to /loans/pos-initiation and exposes the server agreed total", async () => {
    const { result } = renderHook(() => useCreatePosLoan(), { wrapper });

    await expect(result.current.mutateAsync(baseInput())).resolves.toEqual(
      initiation,
    );

    expect(apiMock.post).toHaveBeenCalledWith(
      "/loans/pos-initiation",
      expect.any(Object),
    );
    // React Query v5 notifies observers on a `setTimeout(0)` task, so the
    // settled value must be awaited rather than read synchronously.
    await waitFor(() =>
      expect(result.current.data?.agreedCustomerTotal).toBe("12345.00"),
    );
  });

  it("generates a non-empty requestKey and defaults issuedAt to a YYYY-MM-DD date", async () => {
    const { result } = renderHook(() => useCreatePosLoan(), { wrapper });

    await result.current.mutateAsync(baseInput());

    const body = postedBody();
    expect(body.customerId).toBe("customer-1");
    expect(body.reason).toBe("Venta financiada");
    expect(typeof body.requestKey).toBe("string");
    expect(body.requestKey?.length).toBeGreaterThan(0);
    expect(body.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("passes ids, quantities and the line discount through, keeping unitPrice only for a deliberate override", async () => {
    const { result } = renderHook(() => useCreatePosLoan(), { wrapper });

    await result.current.mutateAsync(
      baseInput({
        discountAmount: 5000,
        items: [
          { productId: "p-a", quantity: 3, discountAmount: 500 },
          { productId: "p-b", quantity: 1, unitPrice: 45000 },
        ],
      }),
    );

    const body = postedBody();
    expect(body.discountAmount).toBe(5000);
    expect(body.items).toEqual([
      { productId: "p-a", quantity: 3, discountAmount: 500 },
      { productId: "p-b", quantity: 1, unitPrice: 45000 },
    ]);
    expect(body.items[0]).not.toHaveProperty("unitPrice");
  });
});

describe("loan servicing", () => {
  const params = { type: "MONEY" as const, page: 2, limit: 10 };
  const page: LoanPage<Loan> = {
    data: [loan], total: 1, page: 2, limit: 10, totalPages: 1,
  };
  const historyPage: LoanPage<LoanHistoryEvent> = {
    data: [historyEvent], total: 1, page: 1, limit: 20, totalPages: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("useLoans fetches /loans with the filter params, omitting them when absent", async () => {
    apiGetMock.mockResolvedValue({ data: page });
    const filtered = renderHook(() => useLoans(params), { wrapper });
    await waitFor(() => expect(filtered.result.current.isSuccess).toBe(true));
    expect(apiGetMock).toHaveBeenCalledWith("/loans", params);
    expect(filtered.result.current.data).toEqual(page);
    const unfiltered = renderHook(() => useLoans(), { wrapper });
    await waitFor(() => expect(unfiltered.result.current.isSuccess).toBe(true));
    expect(apiGetMock).toHaveBeenCalledWith("/loans", undefined);
  });

  it("useLoan fetches one loan by id and stays disabled without an id", async () => {
    apiGetMock.mockResolvedValue({ data: loan });
    const { result } = renderHook(() => useLoan("loan-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGetMock).toHaveBeenCalledWith("/loans/loan-1");
    expect(result.current.data).toEqual(loan);
    // A disabled query must not start even after a full task elapses.
    renderHook(() => useLoan(""), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it("useLoanHistory fetches /loans/:id/history and stays disabled without an id", async () => {
    apiGetMock.mockResolvedValue({ data: historyPage });
    const { result } = renderHook(() => useLoanHistory("loan-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGetMock).toHaveBeenCalledWith("/loans/loan-1/history");
    expect(result.current.data).toEqual(historyPage);
    renderHook(() => useLoanHistory(""), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it("useCollectLoan posts amount and method with a generated or pinned requestKey", async () => {
    apiMock.post.mockResolvedValue({ data: collectResult });
    const { result } = renderHook(() => useCollectLoan(), { wrapper });
    await expect(
      result.current.mutateAsync({ id: "loan-1", amount: 1000, method: "CASH" }),
    ).resolves.toEqual(collectResult);
    expect(apiMock.post).toHaveBeenCalledWith("/loans/loan-1/collections", {
      requestKey: expect.any(String),
      amount: 1000,
      method: "CASH",
    });
    expect(postedMutationBody().requestKey.length).toBeGreaterThan(0);
    await waitFor(() => expect(result.current.data?.balance).toBe("11345.00"));
    const pinned = renderHook(() => useCollectLoan(), { wrapper });
    await pinned.result.current.mutateAsync({
      id: "loan-1",
      amount: 2500.5,
      method: "CARD",
      requestKey: "stable-collection-key",
    });
    expect(apiMock.post).toHaveBeenLastCalledWith("/loans/loan-1/collections", {
      requestKey: "stable-collection-key",
      amount: 2500.5,
      method: "CARD",
    });
  });

  it("useCollectLoan invalidates loans, the loan, its history and the dashboard only", async () => {
    apiMock.post.mockResolvedValue({ data: collectResult });
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCollectLoan(), {
      wrapper: wrapperWith(queryClient),
    });
    await result.current.mutateAsync({
      id: "loan-1",
      amount: 1000,
      method: "TRANSFER",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["loans"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["loan", "loan-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["loan-history", "loan-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["products"] });
  });

  it("useCompletePosLoan sends ONLY requestKey, generated or pinned", async () => {
    apiMock.post.mockResolvedValue({ data: completionResult });
    const { result } = renderHook(() => useCompletePosLoan(), { wrapper });
    await expect(result.current.mutateAsync({ id: "loan-1" })).resolves.toEqual(
      completionResult,
    );
    expect(apiMock.post).toHaveBeenCalledWith("/loans/loan-1/pos-completion", {
      requestKey: expect.any(String),
    });
    const body = postedMutationBody();
    expect(Object.keys(body)).toEqual(["requestKey"]);
    expect(body.requestKey.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("items");
    expect(body).not.toHaveProperty("payments");
    expect(body).not.toHaveProperty("saleId");
    expect(body).not.toHaveProperty("total");
    await waitFor(() => expect(result.current.data?.saleId).toBe("sale-1"));
    const pinned = renderHook(() => useCompletePosLoan(), { wrapper });
    await pinned.result.current.mutateAsync({
      id: "loan-1",
      requestKey: "stable-completion-key",
    });
    expect(apiMock.post).toHaveBeenLastCalledWith("/loans/loan-1/pos-completion", {
      requestKey: "stable-completion-key",
    });
  });

  it("useCompletePosLoan also invalidates products and the dashboard", async () => {
    apiMock.post.mockResolvedValue({ data: completionResult });
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCompletePosLoan(), {
      wrapper: wrapperWith(queryClient),
    });

    await result.current.mutateAsync({ id: "loan-1" });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["loans"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["loan", "loan-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["loan-history", "loan-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["products"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });
});
