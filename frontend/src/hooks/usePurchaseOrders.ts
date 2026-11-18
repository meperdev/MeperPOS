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

export interface ConfirmPurchaseOrderPayload {
  id: string;
  /** Calendar day `YYYY-MM-DD` the supplier is expected to deliver. */
  expectedDeliveryDate?: string;
}

export function useConfirmPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedDeliveryDate }: ConfirmPurchaseOrderPayload) =>
      api
        .post<PurchaseOrder>(
          `/purchase-orders/${id}/confirm`,
          expectedDeliveryDate ? { expectedDeliveryDate } : {},
        )
        .then((res) => res.data),
    onSuccess: (_data, vars) => invalidateAll(queryClient, vars.id),
  });
}

/** Records the send; the first one freezes the document the supplier receives. */
export function useSendPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api
        .post<PurchaseOrder>(`/purchase-orders/${id}/send`)
        .then((res) => res.data),
    onSuccess: (_data, id) => invalidateAll(queryClient, id),
  });
}

/** Downloads the order document the backend renders. */
export async function downloadPurchaseOrderPdf(
  order: Pick<PurchaseOrder, "id" | "orderNumber">,
): Promise<void> {
  const { blob, filename } = await api.getBlob(
    `/purchase-orders/${order.id}/pdf`,
  );
  api.saveBlob(
    blob.type === "application/pdf"
      ? blob
      : new Blob([blob], { type: "application/pdf" }),
    // Keep a meaningful name when a proxy strips Content-Disposition.
    filename.startsWith("export_")
      ? `orden_compra_OC-${order.orderNumber}.pdf`
      : filename,
  );
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
