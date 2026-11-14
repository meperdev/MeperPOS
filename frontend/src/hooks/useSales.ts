"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
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

export function useCreateSale() {
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
    }) =>
      api.post<Sale>("/sales", data).then((res) => res.data),
    onSuccess: () => {
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
