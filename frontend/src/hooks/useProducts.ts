"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Product, ProductType, PaginatedResponse, SearchProductResult } from "@/types";

export function useProducts(params?: {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  type?: ProductType;
  ids?: string[];
  available?: boolean;
  status?: "active" | "inactive" | "all";
  lowStock?: boolean;
  orderBy?: "name" | "createdAt";
  enabled?: boolean;
}) {
  const { enabled = true, ids, ...other } = params ?? {};
  // A string preserves the important empty-list vs omitted distinction on the wire.
  const rest = { ...other, ...(ids === undefined ? {} : { ids: [...new Set(ids)].sort().join(',') }) };
  return useQuery({
    queryKey: ["products", rest],
    queryFn: () =>
      api.get<PaginatedResponse<Product>>("/products", rest).then(
        (res) => res.data
      ),
    enabled,
    placeholderData: (previousData, previousQuery) => {
      const previousParams = previousQuery?.queryKey[1] as { categoryId?: string; type?: ProductType; ids?: string; available?: boolean } | undefined;
      return previousParams?.categoryId === rest.categoryId && previousParams?.type === rest.type && previousParams?.ids === rest.ids && previousParams?.available === rest.available
        ? keepPreviousData(previousData) : undefined;
    },
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: ["product", id],
    queryFn: () =>
      api.get<Product>(`/products/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

export function useLowStockProducts(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["products", "low-stock"],
    queryFn: () =>
      api.get<Product[]>("/products/low-stock").then((res) => res.data),
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  });
}

export function useSearchProducts(query: string, limit = 20) {
  return useQuery({
    queryKey: ["products", "search", query, limit],
    queryFn: () =>
      api
        .get<SearchProductResult[]>("/products/search", { q: query, limit })
        .then((res) => res.data),
    enabled: query.length > 2,
  });
}

export function useQuickSearch(code: string) {
  return useQuery({
    queryKey: ["products", "quick-search", code],
    queryFn: () =>
      api.get<Product | null>("/products/quick-search", { code }).then(
        (res) => res.data
      ),
    enabled: code.length > 0,
  });
}

export function useQuickSearchProduct() {
  return useMutation({
    mutationFn: (code: string) =>
      api.get<Product | null>("/products/quick-search", { code }).then(
        (res) => res.data
      ),
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<Product>) =>
      api.post<Product>("/products", data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Product> }) =>
      api.put<Product>(`/products/${id}`, data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/products/${id}`).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useDeactivateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.put<Product>(`/products/${id}/deactivate`).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useReactivateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.put<Product>(`/products/${id}/reactivate`).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useUploadProductImage() {
  return useMutation({
    mutationFn: (file: File) =>
      api.upload<{ imageUrl: string }>("/products/upload", file).then(
        (res) => res.data
      ),
  });
}

export function useUploadProductImageById(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) =>
      api.upload<Product>(`/products/${productId}/upload`, file).then(
        (res) => res.data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product", productId] });
    },
  });
}
