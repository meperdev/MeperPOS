import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { api } from "@/lib/api";
import type {
  Expense,
  ExpenseAuditEntry,
  ExpenseGroup,
  ExpenseLabel,
  ExpenseMonthlySummary,
  ExpensePayment,
  PaginatedResponse,
} from "@/types";
import {
  useAddExpensePayment,
  useCreateExpense,
  useCreateExpenseGroup,
  useCreateExpenseLabel,
  useDeleteExpense,
  useDeleteExpenseGroup,
  useDeleteExpenseLabel,
  useDuplicateExpense,
  useExpense,
  useExpenseGroups,
  useExpenseHistory,
  useExpenses,
  useExpenseSummary,
  useUpdateExpense,
  useUpdateExpenseGroup,
  useUpdateExpenseLabel,
  useUploadExpenseReceipt,
} from "./useExpenses";
import type { CreateExpensePayload, ExpensePaymentPayload } from "./useExpenses";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}));

type MockApi = {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
};

const apiMock = api as unknown as MockApi;

function makeGroup(overrides: Partial<ExpenseGroup> = {}): ExpenseGroup {
  return {
    id: "group-1",
    organizationId: "org-a",
    name: "Gastos del local",
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeLabel(overrides: Partial<ExpenseLabel> = {}): ExpenseLabel {
  return {
    id: "label-1",
    organizationId: "org-a",
    groupId: "group-1",
    name: "Arriendo",
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePayment(overrides: Partial<ExpensePayment> = {}): ExpensePayment {
  return {
    id: "pay-1",
    expenseId: "exp-1",
    organizationId: "org-a",
    amount: 500000,
    method: "CASH",
    date: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp-1",
    organizationId: "org-a",
    labelId: "label-1",
    label: makeLabel(),
    supplierId: null,
    purchaseOrderId: null,
    description: "Arriendo agosto",
    date: "2026-08-01T00:00:00.000Z",
    total: 500000,
    status: "PAID",
    receiptUrl: null,
    active: true,
    createdById: "user-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    payments: [makePayment()],
    ...overrides,
  };
}

function makePage(items: Expense[]): PaginatedResponse<Expense> {
  return {
    data: items,
    meta: { total: items.length, page: 1, limit: 10, totalPages: 1 },
  };
}

function makeSummary(): ExpenseMonthlySummary {
  return {
    month: "2026-08",
    total: 500000,
    groups: [{ groupId: "group-1", name: "Gastos del local", total: 500000, labels: [{ labelId: "label-1", name: "Arriendo", total: 500000 }] }],
  };
}

function makeAuditEntry(): ExpenseAuditEntry {
  return {
    id: "audit-1",
    userId: "user-1",
    action: "EXPENSE_CREATED",
    resource: "Expense",
    resourceId: "exp-1",
    metadata: { summary: "Salida creada" },
    createdAt: "2026-08-01T00:00:00.000Z",
    organizationId: "org-a",
    user: { name: "Ana Perez", email: "ana@example.com" },
  };
}

function wrapperWith(queryClient: QueryClient) {
  return function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("useExpenses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("queries", () => {
    it("fetches the paginated list with query params under the expenses key", async () => {
      const params = { page: 1, limit: 10, month: "2026-08" };
      const page = makePage([makeExpense()]);
      apiMock.get.mockResolvedValue({ data: page });

      const { result } = renderHook(() => useExpenses(params), {
        wrapper: wrapperWith(makeQueryClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiMock.get).toHaveBeenCalledWith("/expenses", params);
      expect(result.current.data).toEqual(page);
    });

    it("fetches a single expense by id", async () => {
      const expense = makeExpense();
      apiMock.get.mockResolvedValue({ data: expense });

      const { result } = renderHook(() => useExpense("exp-1"), {
        wrapper: wrapperWith(makeQueryClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiMock.get).toHaveBeenCalledWith("/expenses/exp-1");
      expect(result.current.data).toEqual(expense);
    });

    it("does not fetch a single expense without an id", () => {
      renderHook(() => useExpense(""), {
        wrapper: wrapperWith(makeQueryClient()),
      });

      expect(apiMock.get).not.toHaveBeenCalled();
    });

    it("fetches the monthly summary for the requested month", async () => {
      const summary = makeSummary();
      apiMock.get.mockResolvedValue({ data: summary });

      const { result } = renderHook(() => useExpenseSummary("2026-08"), {
        wrapper: wrapperWith(makeQueryClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiMock.get).toHaveBeenCalledWith("/expenses/summary/monthly", {
        month: "2026-08",
      });
      expect(result.current.data).toEqual(summary);
    });

    it("fetches the audit history of an expense", async () => {
      const entries = [makeAuditEntry()];
      apiMock.get.mockResolvedValue({ data: entries });

      const { result } = renderHook(() => useExpenseHistory("exp-1"), {
        wrapper: wrapperWith(makeQueryClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiMock.get).toHaveBeenCalledWith("/expenses/exp-1/history");
      expect(result.current.data).toEqual(entries);
    });

    it("fetches groups with nested labels", async () => {
      const groups = [makeGroup({ labels: [makeLabel()] })];
      apiMock.get.mockResolvedValue({ data: groups });

      const { result } = renderHook(() => useExpenseGroups(), {
        wrapper: wrapperWith(makeQueryClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiMock.get).toHaveBeenCalledWith("/expense-groups");
      expect(result.current.data).toEqual(groups);
    });

    it("keeps the previous rows on screen while the next page loads", async () => {
      const firstPage = makePage([makeExpense({ id: "exp-a" })]);
      apiMock.get.mockResolvedValueOnce({ data: firstPage });

      const { result, rerender } = renderHook(
        ({ params }: { params: { page: number; limit: number } }) =>
          useExpenses(params),
        {
          wrapper: wrapperWith(makeQueryClient()),
          initialProps: { params: { page: 1, limit: 10 } },
        },
      );

      await waitFor(() => expect(result.current.data).toEqual(firstPage));

      // The next page never settles, so anything on screen is the placeholder.
      apiMock.get.mockReturnValue(new Promise(() => {}));
      rerender({ params: { page: 2, limit: 10 } });

      await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
      expect(result.current.data).toEqual(firstPage);
    });
  });

  describe("mutations", () => {
    it("creates an expense and invalidates expense queries", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const expense = makeExpense();
      apiMock.post.mockResolvedValue({ data: expense });

      const { result } = renderHook(() => useCreateExpense(), {
        wrapper: wrapperWith(queryClient),
      });

      const payload: CreateExpensePayload = {
        labelId: "label-1",
        description: "Arriendo agosto",
        date: "2026-08-01",
        total: 500000,
        payments: [
          { amount: 500000, method: "CASH", date: "2026-08-01" },
        ],
      };

      await result.current.mutateAsync(payload);

      expect(apiMock.post).toHaveBeenCalledWith("/expenses", payload);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expenses"] });
    });

    it("updates an expense and invalidates expense queries", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      apiMock.patch.mockResolvedValue({ data: makeExpense() });

      const { result } = renderHook(() => useUpdateExpense(), {
        wrapper: wrapperWith(queryClient),
      });

      const payload = { description: "Arriendo septiembre" };
      await result.current.mutateAsync({ id: "exp-1", data: payload });

      expect(apiMock.patch).toHaveBeenCalledWith("/expenses/exp-1", payload);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expenses"] });
    });

    it("deletes an expense and invalidates expense queries", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      apiMock.delete.mockResolvedValue({ data: makeExpense() });

      const { result } = renderHook(() => useDeleteExpense(), {
        wrapper: wrapperWith(queryClient),
      });

      await result.current.mutateAsync("exp-1");

      expect(apiMock.delete).toHaveBeenCalledWith("/expenses/exp-1");
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expenses"] });
    });

    it("adds a payment and invalidates expense queries", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      apiMock.post.mockResolvedValue({ data: makeExpense() });

      const { result } = renderHook(() => useAddExpensePayment(), {
        wrapper: wrapperWith(queryClient),
      });

      const payload: ExpensePaymentPayload = {
        amount: 100000,
        method: "TRANSFER",
        date: "2026-08-10",
      };
      await result.current.mutateAsync({ id: "exp-1", data: payload });

      expect(apiMock.post).toHaveBeenCalledWith("/expenses/exp-1/payments", payload);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expenses"] });
    });

    it("duplicates an expense and invalidates expense queries", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      apiMock.post.mockResolvedValue({ data: makeExpense() });

      const { result } = renderHook(() => useDuplicateExpense(), {
        wrapper: wrapperWith(queryClient),
      });

      await result.current.mutateAsync("exp-1");

      expect(apiMock.post).toHaveBeenCalledWith("/expenses/exp-1/duplicate");
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expenses"] });
    });

    it("uploads a receipt via multipart and invalidates expense queries", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      apiMock.upload.mockResolvedValue({ data: makeExpense() });

      const { result } = renderHook(() => useUploadExpenseReceipt(), {
        wrapper: wrapperWith(queryClient),
      });

      const file = new File(["receipt"], "comprobante.jpg", {
        type: "image/jpeg",
      });
      await result.current.mutateAsync({ id: "exp-1", file });

      expect(apiMock.upload).toHaveBeenCalledWith("/expenses/exp-1/upload", file);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expenses"] });
    });

    it("can skip the per-request invalidation when a caller chains requests", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      apiMock.post.mockResolvedValue({ data: makeExpense() });
      apiMock.upload.mockResolvedValue({ data: makeExpense() });

      const create = renderHook(
        () => useCreateExpense({ invalidate: false }),
        { wrapper: wrapperWith(queryClient) },
      );
      const upload = renderHook(
        () => useUploadExpenseReceipt({ invalidate: false }),
        { wrapper: wrapperWith(queryClient) },
      );

      await create.result.current.mutateAsync({
        labelId: "label-1",
        description: "Arriendo agosto",
        date: "2026-08-01",
        total: 500000,
        payments: [{ amount: 500000, method: "CASH", date: "2026-08-01" }],
      });
      await upload.result.current.mutateAsync({
        id: "exp-1",
        file: new File(["receipt"], "comprobante.jpg", { type: "image/jpeg" }),
      });

      // The chained caller refreshes once at the end, on its own.
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it("creates a group and invalidates taxonomy, expenses, and summary queries", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      apiMock.post.mockResolvedValue({ data: makeGroup() });

      const { result } = renderHook(() => useCreateExpenseGroup(), {
        wrapper: wrapperWith(queryClient),
      });

      await result.current.mutateAsync({ name: "Impuestos" });

      expect(apiMock.post).toHaveBeenCalledWith("/expense-groups", {
        name: "Impuestos",
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expense-groups"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expenses"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expenses", "summary"] });
    });

    it("updates a label through its group endpoint", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      apiMock.patch.mockResolvedValue({ data: makeLabel() });

      const { result } = renderHook(() => useUpdateExpenseLabel(), {
        wrapper: wrapperWith(queryClient),
      });

      await result.current.mutateAsync({ groupId: "group-1", id: "label-1", data: { name: "Servicios" } });

      expect(apiMock.patch).toHaveBeenCalledWith("/expense-groups/group-1/labels/label-1", {
        name: "Servicios",
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expense-groups"] });
    });

    it("deletes a label and invalidates taxonomy queries", async () => {
      const queryClient = makeQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      apiMock.delete.mockResolvedValue({ data: makeLabel() });

      const { result } = renderHook(() => useDeleteExpenseLabel(), {
        wrapper: wrapperWith(queryClient),
      });

      await result.current.mutateAsync({ groupId: "group-1", id: "label-1" });

      expect(apiMock.delete).toHaveBeenCalledWith("/expense-groups/group-1/labels/label-1");
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["expense-groups"] });
    });
  });
});
