"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Supplier, PaginatedResponse } from "@/types";

export type SupplierPayload = Partial<
  Pick<
    Supplier,
    | "name"
    | "documentNumber"
    | "email"
    | "phone"
    | "address"
    | "contactName"
    | "bank"
    | "accountNumber"
    | "accountType"
    | "active"
  >
>;

export function useSuppliers(params?: {
  page?: number;
  limit?: number;
  search?: string;
  status?: "active" | "inactive" | "all";
}) {
  return useQuery({
    queryKey: ["suppliers", params],
    queryFn: () =>
      api
        .get<PaginatedResponse<Supplier>>("/suppliers", params)
        .then((res) => res.data),
    // Paging, searching or filtering keeps the current rows on screen while the
    // next page loads, instead of dropping the list back to a skeleton.
    placeholderData: keepPreviousData,
  });
}

export function useSupplier(id: string) {
  return useQuery({
    queryKey: ["supplier", id],
    queryFn: () =>
      api.get<Supplier>(`/suppliers/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

export function useCreateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SupplierPayload) =>
      api.post<Supplier>("/suppliers", data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
}

export function useUpdateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SupplierPayload }) =>
      api
        .patch<Supplier>(`/suppliers/${id}`, data)
        .then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
}

export function useDeactivateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/suppliers/${id}`).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
}

export function useReactivateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api
        .post<Supplier>(`/suppliers/${id}/reactivate`)
        .then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
}
