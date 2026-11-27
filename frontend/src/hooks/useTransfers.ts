"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  PaginatedResponse,
  StockTransfer,
  StockTransferStatus,
} from "@/types";

/** Every surface that lists or opens a transfer reads this key. */
export const TRANSFERS_QUERY_KEY = ["transfers"] as const;

/** The detail of one transfer, so a mutation can refresh it by identity. */
export const transferQueryKey = (id: string) => ["transfer", id] as const;

export interface TransferFilters {
  page?: number;
  limit?: number;
  status?: StockTransferStatus;
  /** Only transfers that start or end at this site. */
  siteId?: string;
}

export interface CreateTransferItemPayload {
  productId: string;
  quantity: number;
}

export interface CreateTransferPayload {
  fromLocationId: string;
  toLocationId: string;
  notes?: string;
  items: CreateTransferItemPayload[];
}

function getTransfersRequest(params?: TransferFilters) {
  return api.get<PaginatedResponse<StockTransfer>>(
    "/transfers",
    params ? { ...params } : undefined,
  );
}

function getTransferRequest(id: string) {
  return api.get<StockTransfer>(`/transfers/${encodeURIComponent(id)}`);
}

function dispatchTransferRequest(payload: CreateTransferPayload) {
  const notes = payload.notes?.trim();
  return api.post<StockTransfer>("/transfers", {
    fromLocationId: payload.fromLocationId,
    toLocationId: payload.toLocationId,
    // A note is optional: an empty one is not stored as an empty string.
    ...(notes ? { notes } : {}),
    items: payload.items,
  });
}

function receiveTransferRequest(id: string) {
  return api.post<StockTransfer>(
    `/transfers/${encodeURIComponent(id)}/receive`,
  );
}

function cancelTransferRequest(id: string, reason: string) {
  return api.post<StockTransfer>(
    `/transfers/${encodeURIComponent(id)}/cancel`,
    { reason },
  );
}

/**
 * Dispatching, receiving and cancelling all move stock, so the list, the opened
 * document, the product catalogue and any cached kárdex page drift together.
 */
function invalidateTransferData(
  queryClient: ReturnType<typeof useQueryClient>,
  id?: string,
) {
  void queryClient.invalidateQueries({ queryKey: TRANSFERS_QUERY_KEY });
  if (id) {
    void queryClient.invalidateQueries({ queryKey: transferQueryKey(id) });
  }
  void queryClient.invalidateQueries({ queryKey: ["products"] });
  void queryClient.invalidateQueries({ queryKey: ["inventory-movements"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
}

export function useTransfers(params?: TransferFilters) {
  return useQuery({
    queryKey: [...TRANSFERS_QUERY_KEY, params],
    queryFn: () => getTransfersRequest(params).then((res) => res.data),
    // Paging or filtering keeps the current rows on screen while the next page
    // loads, instead of dropping the list back to a skeleton.
    placeholderData: keepPreviousData,
  });
}

export function useTransfer(id: string) {
  return useQuery({
    queryKey: transferQueryKey(id),
    queryFn: () => getTransferRequest(id).then((res) => res.data),
    enabled: Boolean(id),
  });
}

/** How many transfers sit in each state for one site scope. */
export interface TransferSummary {
  inTransit: number;
  received: number;
  cancelled: number;
}

/** The summary reads one row per state; its total is all it needs. */
const SUMMARY_LIMIT = 1;

function summaryParams(siteId: string | undefined, status: StockTransferStatus) {
  return {
    status,
    limit: SUMMARY_LIMIT,
    ...(siteId ? { siteId } : {}),
  };
}

/**
 * The state counts the summary band shows. The server owns them: each one is the
 * `meta.total` of a one-row list read, so the page never counts the rows it
 * happens to have on screen, and the role/site rules of the list apply unchanged.
 *
 * Counts follow the site scope, never the state filter: the band answers "how
 * much is where" for the list it sits above.
 */
export function useTransferSummary(siteId?: string) {
  const read = (status: StockTransferStatus) => {
    const params = summaryParams(siteId, status);
    return {
      queryKey: [...TRANSFERS_QUERY_KEY, "summary", params] as const,
      queryFn: () =>
        getTransfersRequest(params).then((res) => res.data.meta.total),
    };
  };

  const inTransit = useQuery(read("IN_TRANSIT"));
  const received = useQuery(read("RECEIVED"));
  const cancelled = useQuery(read("CANCELLED"));

  const data: TransferSummary | undefined =
    inTransit.data !== undefined &&
    received.data !== undefined &&
    cancelled.data !== undefined
      ? {
          inTransit: inTransit.data,
          received: received.data,
          cancelled: cancelled.data,
        }
      : undefined;

  return {
    data,
    isLoading: inTransit.isLoading || received.isLoading || cancelled.isLoading,
  };
}

/** Dispatches stock from an authorized origin site to another site. */
export function useCreateTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateTransferPayload) =>
      dispatchTransferRequest(payload).then((res) => res.data),
    onSuccess: () => invalidateTransferData(queryClient),
  });
}

/** Lands an in-transit transfer at its destination site. */
export function useReceiveTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      receiveTransferRequest(id).then((res) => res.data),
    onSuccess: (_transfer, variables) =>
      invalidateTransferData(queryClient, variables.id),
  });
}

/** Cancels an in-transit transfer and returns its stock to the origin. */
export function useCancelTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      cancelTransferRequest(id, reason).then((res) => res.data),
    onSuccess: (_transfer, variables) =>
      invalidateTransferData(queryClient, variables.id),
  });
}
