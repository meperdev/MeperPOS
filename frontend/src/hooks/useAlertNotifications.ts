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
/** The request path for one page of history, query string included. */
export function historyPath(params: {
  page: number;
  limit: number;
  kind?: StockAlertEventKind;
}): string {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.kind) query.set("kind", params.kind);
  return `/alerts/notifications?${query.toString()}`;
}

export function useAlertNotifications(params: {
  page: number;
  limit: number;
  kind?: StockAlertEventKind;
}) {
  return useQuery({
    queryKey: ["alerts", "notifications", params],
    // The query string is built here, in the URL, so the filter and the page
    // cannot depend on how any HTTP client treats a second argument.
    queryFn: () =>
      api
        .get<StockAlertHistoryPage>(historyPath(params))
        .then((res) => res.data),
    placeholderData: keepPreviousData,
  });
}
