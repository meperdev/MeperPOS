"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Category, PaginatedResponse } from "@/types";

export type CategoryPayload = Partial<
  Pick<Category, "name" | "description" | "active" | "defaultTaxRate">
>;

export type CreateCategoryPayload = Omit<CategoryPayload, "defaultTaxRate"> & {
  defaultTaxRate?: number;
};

export type UpdateCategoryPayload = Omit<CategoryPayload, "defaultTaxRate"> & {
  defaultTaxRate?: number | null;
};

export function useCategories(params?: {
  page?: number;
  limit?: number;
  search?: string;
}) {
  return useQuery({
    queryKey: ["categories", params],
    queryFn: () =>
      api.get<PaginatedResponse<Category>>("/categories", params).then(
        (res) => res.data
      ),
    // Paging or searching keeps the current rows on screen instead of dropping
    // the list back to a skeleton.
    placeholderData: keepPreviousData,
  });
}

export function useCategory(id: string) {
  return useQuery({
    queryKey: ["category", id],
    queryFn: () =>
      api.get<Category>(`/categories/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCategoryPayload) =>
      api.post<Category>("/categories", data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCategoryPayload }) =>
      api.put<Category>(`/categories/${id}`, data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/categories/${id}`).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}
