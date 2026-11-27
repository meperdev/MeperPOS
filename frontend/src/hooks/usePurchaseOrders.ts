"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  PurchaseOrder,
  PaginatedResponse,
  PurchaseOrderStatusFilter,
  SkippedDuplicateItem,
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

export interface ReceivePurchaseOrderPayload {
  id: string;
  items: ReceiveItemPayload[];
  /**
   * Explicit receipt destination. Omitted means the organization's principal
   * site, and the request then stays exactly what it was before sites existed.
   */
  locationId?: string;
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
    // Paging, searching or filtering keeps the current rows on screen while the
    // next page loads, instead of dropping the list back to a skeleton.
    placeholderData: keepPreviousData,
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

export interface SendPurchaseOrderPayload {
  id: string;
  /**
   * Calendar day `YYYY-MM-DD` the supplier is expected to deliver. An order
   * confirmed without one can set it here, on the first send; once sent the
   * document is frozen and the date is ignored.
   */
  expectedDeliveryDate?: string;
}

/** Records the send; the first one freezes the document the supplier receives. */
export function useSendPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedDeliveryDate }: SendPurchaseOrderPayload) =>
      api
        .post<PurchaseOrder>(
          `/purchase-orders/${id}/send`,
          expectedDeliveryDate ? { expectedDeliveryDate } : {},
        )
        .then((res) => res.data),
    onSuccess: (_data, vars) => invalidateAll(queryClient, vars.id),
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

export interface DuplicatePurchaseOrderResult {
  order: PurchaseOrder;
  skippedItems: SkippedDuplicateItem[];
}

/** "Repetir pedido": a new draft with the same products and quantities. */
export function useDuplicatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, supplierId }: { id: string; supplierId?: string }) =>
      api
        .post<DuplicatePurchaseOrderResult>(
          `/purchase-orders/${id}/duplicate`,
          supplierId ? { supplierId } : {},
        )
        .then((res) => res.data),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useReceivePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items, locationId }: ReceivePurchaseOrderPayload) =>
      api
        .post<PurchaseOrder>(`/purchase-orders/${id}/receive`, {
          // The principal site is the server's default, so the field only
          // travels when the user actually chose another destination.
          ...(locationId ? { locationId } : {}),
          items,
        })
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
