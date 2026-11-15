"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type StockAlertEventKind =
  | "OPENED"
  | "RESOLVED"
  | "NOTIFIED"
  | "FAILED"
  | "SKIPPED";

export interface StockAlertHistoryItem {
  id: string;
  product: { id: string; name: string; sku: string };
  episode: number;
  kind: StockAlertEventKind;
  failureReason: string | null;
  createdAt: string;
}

export interface StockAlertHistoryPage {
  data: StockAlertHistoryItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * The stock-alert notification history: one row per episode transition, newest
 * first. Read-only and tenant-scoped on the server.
 */
export function useAlertNotifications(params: {
  page: number;
  limit: number;
  kind?: StockAlertEventKind;
}) {
  return useQuery({
    queryKey: ["alerts", "notifications", params],
    // `api.get(url, params)` serializes the second argument as the query string
    // (see `ApiClient.get` in lib/api.ts), so page, limit and kind reach the
    // endpoint as URL params rather than as an axios request config.
    queryFn: () =>
      api
        .get<StockAlertHistoryPage>("/alerts/notifications", params)
        .then((res) => res.data),
    placeholderData: keepPreviousData,
  });
}
