"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type PosRequestScope } from "@/lib/api";
import { getBogotaDateInputValue } from "@/lib/utils";
import type {
  CollectLoanInput,
  CreatePosLoanInput,
  Loan,
  LoanHistoryEvent,
  LoanOperationResult,
  LoanPage,
  LoanQueryParams,
  PosLoanInitiation,
} from "@/types";

/**
 * POS cart financing (POST /loans/pos-initiation).
 *
 * The server owns every money value: the caller supplies the customer, the cart
 * lines (with `unitPrice` only for a deliberate override) and the optional
 * sale-wide discount. When the caller does not pin a `requestKey` the hook
 * generates one; a page that retries a failed attempt should pin a stable key
 * so the initiation stays idempotent.
 *
 * `posScope` binds the initiation and its retry to the user and tenant the till
 * was rendered for, so a session rotated by another tab cannot finance against
 * another organization. `checkoutLocationId` is the site the till is selling
 * from: it is sent only when a site is active (T3g), so the hold reserves at
 * that site's balance instead of the organization default.
 */
export function useCreatePosLoan(
  posScope?: PosRequestScope,
  checkoutLocationId?: string,
) {
  const queryClient = useQueryClient();

  return useMutation<PosLoanInitiation, Error, CreatePosLoanInput>({
    mutationFn: (data: CreatePosLoanInput) => {
      const body = {
        customerId: data.customerId,
        reason: data.reason,
        // Line `unitPrice` is forwarded only when the caller deliberately
        // overrode it; otherwise the server prices the line itself.
        items: data.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          ...(item.unitPrice !== undefined
            ? { unitPrice: item.unitPrice }
            : {}),
          ...(item.discountAmount !== undefined
            ? { discountAmount: item.discountAmount }
            : {}),
        })),
        // The issue day is the Bogotá day the operator reads on the clock; the
        // UTC date would record an evening sale as issued tomorrow.
        issuedAt: data.issuedAt ?? getBogotaDateInputValue(),
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
        ...(data.discountAmount !== undefined
          ? { discountAmount: data.discountAmount }
          : {}),
        requestKey: data.requestKey ?? crypto.randomUUID(),
        ...(checkoutLocationId ? { locationId: checkoutLocationId } : {}),
      };
      // No config at all outside the POS: the plain call stays byte-identical.
      return (
        posScope
          ? api.post<PosLoanInitiation>("/loans/pos-initiation", body, { posScope })
          : api.post<PosLoanInitiation>("/loans/pos-initiation", body)
      ).then((res) => res.data);
    },
    onSuccess: () => {
      // Mirrors the useSales convention: the initiation moves stock, so the
      // loan list, the product catalogue and the dashboard aggregates all drift.
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useLoans(
  params?: LoanQueryParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["loans", params],
    queryFn: () =>
      api
        .get<LoanPage<Loan>>("/loans", params)
        .then((res) => res.data),
    enabled: options?.enabled ?? true,
  });
}

export function useLoan(id: string) {
  return useQuery({
    queryKey: ["loan", id],
    queryFn: () => api.get<Loan>(`/loans/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

export function useLoanHistory(id: string) {
  return useQuery({
    queryKey: ["loan-history", id],
    queryFn: () =>
      api
        .get<LoanPage<LoanHistoryEvent>>(`/loans/${id}/history`)
        .then((res) => res.data),
    enabled: !!id,
  });
}

/**
 * Store-side invalidation shared by every loan mutation, mirroring the useSales
 * convention. Loan money drifts the loan list, that loan, its history and the
 * dashboard; only a POS completion consumes reserved stock, so only it drifts
 * the product catalogue.
 */
function invalidateLoanData(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  options: { stockChanged: boolean },
) {
  queryClient.invalidateQueries({ queryKey: ["loans"] });
  queryClient.invalidateQueries({ queryKey: ["loan", id] });
  queryClient.invalidateQueries({ queryKey: ["loan-history", id] });
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  if (options.stockChanged) {
    queryClient.invalidateQueries({ queryKey: ["products"] });
  }
}

/** Records a collection (POST /loans/:id/collections). */
export function useCollectLoan() {
  const queryClient = useQueryClient();

  return useMutation<
    LoanOperationResult,
    Error,
    { id: string } & CollectLoanInput
  >({
    mutationFn: ({ id, amount, method, requestKey }) =>
      api
        .post<LoanOperationResult>(`/loans/${id}/collections`, {
          requestKey: requestKey ?? crypto.randomUUID(),
          amount,
          method,
        })
        .then((res) => res.data),
    onSuccess: (_result, vars) =>
      invalidateLoanData(queryClient, vars.id, { stockChanged: false }),
  });
}

/**
 * Finalizes a POS financing into its sale (POST /loans/:id/pos-completion). The
 * stored intent holds every line, total and payment, so the server recomputes
 * the sale and the client sends `requestKey` and nothing else.
 */
export function useCompletePosLoan() {
  const queryClient = useQueryClient();

  return useMutation<
    LoanOperationResult,
    Error,
    { id: string; requestKey?: string }
  >({
    mutationFn: ({ id, requestKey }) =>
      api
        .post<LoanOperationResult>(`/loans/${id}/pos-completion`, {
          requestKey: requestKey ?? crypto.randomUUID(),
        })
        .then((res) => res.data),
    onSuccess: (_result, vars) =>
      invalidateLoanData(queryClient, vars.id, { stockChanged: true }),
  });
}
