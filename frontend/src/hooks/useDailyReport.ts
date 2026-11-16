"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DailyReport } from "@/types";

/**
 * The daily report always covers today in Bogotá, so it deliberately takes no
 * date range: the page's period filter never reaches it. It is also never
 * served stale, because the cutoff moves with the clock.
 */
export function useDailyReport() {
  return useQuery({
    queryKey: ["reports", "daily-report"],
    queryFn: () =>
      api.get<DailyReport>("/reports/daily-report").then((res) => res.data),
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
