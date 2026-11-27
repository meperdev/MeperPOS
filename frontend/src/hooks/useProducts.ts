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
  /**
   * Read one site's balance instead of the organization aggregate (POS, T3f).
   * Omit it on every other screen: without a site the request is exactly the
   * organization-wide one it has always been.
   */
  locationId?: string;
  /**
   * With a site, list only the products that site carries instead of the whole
   * catalog (T25). It is meaningless without `locationId`, so it is sent only
   * when the caller has one.
   */
  carriedAtSite?: boolean;
  enabled?: boolean;
}) {
  const { enabled = true, ids, locationId, carriedAtSite, ...other } = params ?? {};
  // A string preserves the important empty-list vs omitted distinction on the wire.
  const rest = {
    ...other,
    ...(ids === undefined ? {} : { ids: [...new Set(ids)].sort().join(',') }),
    // An omitted site keeps the request (and its cache key) byte-identical.
    ...(locationId === undefined ? {} : { locationId }),
    ...(carriedAtSite === undefined ? {} : { carriedAtSite }),
  };
  return useQuery({
    queryKey: ["products", rest],
    queryFn: () =>
      api.get<PaginatedResponse<Product>>("/products", rest).then(
        (res) => res.data
      ),
    enabled,
    placeholderData: (previousData, previousQuery) => {
      const previousParams = previousQuery?.queryKey[1] as { categoryId?: string; type?: ProductType; ids?: string; available?: boolean; locationId?: string; carriedAtSite?: boolean } | undefined;
      // A site change is not a refinement of the previous page: keeping it as a
      // placeholder would show one site's stock while the next site loads. The
      // same holds for the assortment switch, which changes the set itself.
      return previousParams?.categoryId === rest.categoryId && previousParams?.type === rest.type && previousParams?.ids === rest.ids && previousParams?.available === rest.available && previousParams?.locationId === rest.locationId && previousParams?.carriedAtSite === rest.carriedAtSite
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

export function useSearchProducts(
  query: string,
  limit = 20,
  locationId?: string
) {
  return useQuery({
    queryKey: ["products", "search", query, limit, locationId],
    queryFn: () =>
      api
        .get<SearchProductResult[]>("/products/search", {
          q: query,
          limit,
          ...(locationId === undefined ? {} : { locationId }),
        })
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

/**
 * The POS scanner: the exact barcode/SKU lookup runs for the site the till is
 * serving, so a code stocked only at another site answers with this site's
 * (zero) availability. Without a site it keeps the organization aggregate.
 */
export function useQuickSearchProduct(options?: { locationId?: string }) {
  const locationId = options?.locationId;
  return useMutation({
    mutationFn: (code: string) =>
      api
        .get<Product | null>("/products/quick-search", {
          code,
          ...(locationId === undefined ? {} : { locationId }),
        })
        .then((res) => res.data),
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
