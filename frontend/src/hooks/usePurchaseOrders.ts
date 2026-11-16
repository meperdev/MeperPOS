"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  PurchaseOrder,
  PaginatedResponse,
  PurchaseOrderStatusFilter,
} from "@/types";

export interface PurchaseOrderFilters {
  page?: number;
  limit?: number;
  supplierId?: string;
  status?: PurchaseOrderStatusFilter | "";
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

export interface CreatePurchaseOrderItemPayload {
  productId: string;
  qtyOrdered: number;
  unitCost: number;
  taxRate: number;
}

export interface CreatePurchaseOrderPayload {
  supplierId: string;
  notes?: string;
  items: CreatePurchaseOrderItemPayload[];
}

export interface UpdatePurchaseOrderPayload {
  supplierId?: string;
  notes?: string;
  items?: CreatePurchaseOrderItemPayload[];
}

export interface ReceiveItemPayload {
  itemId: string;
  qtyReceivedNow: number;
}

function toQueryParams(
  params?: PurchaseOrderFilters,
): Record<string, unknown> | undefined {
  if (!params) {
    return undefined;
  }

  return { ...params };
}

export function usePurchaseOrders(params?: PurchaseOrderFilters) {
  return useQuery({
    queryKey: ["purchase-orders", params],
    queryFn: () =>
      api
        .get<PaginatedResponse<PurchaseOrder>>(
          "/purchase-orders",
          toQueryParams(params),
        )
        .then((res) => res.data),
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: ["purchase-order", id],
    queryFn: () =>
      api
        .get<PurchaseOrder>(`/purchase-orders/${id}`)
        .then((res) => res.data),
    enabled: !!id,
  });
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>, id?: string) {
  queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  if (id) queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
  queryClient.invalidateQueries({ queryKey: ["products"] });
}

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePurchaseOrderPayload) =>
      api
        .post<PurchaseOrder>("/purchase-orders", data)
        .then((res) => res.data),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useUpdatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePurchaseOrderPayload }) =>
      api
        .patch<PurchaseOrder>(`/purchase-orders/${id}`, data)
        .then((res) => res.data),
    onSuccess: (_data, vars) => invalidateAll(queryClient, vars.id),
  });
}

export function useConfirmPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api
        .post<PurchaseOrder>(`/purchase-orders/${id}/confirm`)
        .then((res) => res.data),
    onSuccess: (_data, id) => invalidateAll(queryClient, id),
  });
}

export function useReceivePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: ReceiveItemPayload[] }) =>
      api
        .post<PurchaseOrder>(`/purchase-orders/${id}/receive`, { items })
        .then((res) => res.data),
    onSuccess: (_data, vars) => invalidateAll(queryClient, vars.id),
  });
}

export function useCancelPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api
        .post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason })
        .then((res) => res.data),
    onSuccess: (_data, vars) => invalidateAll(queryClient, vars.id),
  });
}
