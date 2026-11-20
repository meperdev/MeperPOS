"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Customer, PaginatedResponse } from "@/types";

export type CustomerPayload = Partial<
  Pick<
    Customer,
    | "name"
    | "documentType"
    | "documentNumber"
    | "email"
    | "phone"
    | "address"
    | "referencia"
    | "placaMoto"
    | "segment"
    | "active"
  >
>;

export function useCustomers(params?: {
  page?: number;
  limit?: number;
  search?: string;
  segment?: string;
}) {
  return useQuery({
    queryKey: ["customers", params],
    queryFn: () =>
      api.get<PaginatedResponse<Customer>>("/customers", params).then(
        (res) => res.data
      ),
    // Paging, searching or filtering keeps the current rows on screen while the
    // next page loads, instead of dropping the list back to a skeleton.
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: ["customer", id],
    queryFn: () =>
      api.get<Customer>(`/customers/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

export function useCustomerByDocument(documentNumber: string) {
  return useQuery({
    queryKey: ["customer", "document", documentNumber],
    queryFn: () =>
      api
        .get<Customer>(`/customers/document/${documentNumber}`)
        .then((res) => res.data),
    enabled: documentNumber.length > 0,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CustomerPayload) =>
      api.post<Customer>("/customers", data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: CustomerPayload }) =>
      api.put<Customer>(`/customers/${id}`, data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/customers/${id}`).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}
