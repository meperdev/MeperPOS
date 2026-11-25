"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, type PosRequestScope } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import type { Sale, PaginatedResponse, CartItem, SaleFilters } from "@/types";

export function useSales(params?: SaleFilters) {
  return useQuery({
    queryKey: ["sales", params],
    queryFn: () =>
      api
        .get<PaginatedResponse<Sale>>(
          "/sales",
          params as Record<string, unknown> | undefined,
        )
        .then(
        (res) => res.data
      ),
    // A fitted table size changes the key right after mount; showing the rows we
    // already have keeps the list mounted so it can be re-measured in place.
    placeholderData: keepPreviousData,
  });
}

export function useSale(id: string) {
  return useQuery({
    queryKey: ["sale", id],
    queryFn: () =>
      api.get<Sale>(`/sales/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

export function useSaleByNumber(saleNumber: number) {
  return useQuery({
    queryKey: ["sale", "number", saleNumber],
    queryFn: () =>
      api.get<Sale>(`/sales/number/${saleNumber}`).then((res) => res.data),
    enabled: !!saleNumber,
  });
}

/**
 * Records a sale. `posScope` binds the request to the user and tenant the till
 * was rendered for, so a session rotated by another tab cannot charge under a
 * different organization; callers outside the POS pass nothing.
 */
export function useCreateSale(posScope?: PosRequestScope) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      customerId?: string;
      // `unitPrice` is optional and should be sent ONLY for a deliberate
      // manager override: the server derives the effective (promotion-aware)
      // price itself and rejects an override from a non-ADMIN. Echoing the
      // cart price back on every line would turn a promotion edited after the
      // line was added into a spurious "override".
      items: Array<
        Pick<CartItem, "productId" | "quantity" | "discountAmount"> & {
          unitPrice?: number;
        }
      >;
      discountAmount?: number;
      payments?: Array<{
        method: "CASH" | "CARD" | "TRANSFER";
        amount: number;
      }>;
      // SEC-014 idempotency key. The caller pins one per checkout intent and
      // reuses it while the outcome is uncertain, so a retried request that the
      // server already persisted replays that sale instead of selling twice.
      // Optional: a caller without an intent still posts a plain sale.
      requestKey?: string;
    }) =>
      // No config at all outside the POS: the plain call stays byte-identical.
      (posScope
        ? api.post<Sale>("/sales", data, { posScope })
        : api.post<Sale>("/sales", data)
      ).then((res) => res.data),
    onSuccess: () => {
      // Payment confirmed: the one haptic that confirms money moved (S4.2).
      // It lives here, not in the POS page, so every sale path feels the same.
      haptic("success");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateSaleStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.put<Sale>(`/sales/${id}`, { status }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
