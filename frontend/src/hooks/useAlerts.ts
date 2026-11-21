"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertCategory = "billing" | "limits" | "stock" | "loans" | "tasks";

export interface AppAlert {
  /** Stable identity of the condition. */
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string;
  /**
   * Fingerprint of the facts behind the alert. A different revision means the
   * condition changed (a new product at its minimum, a new overdue loan), which
   * is what makes the bell ring again without inventing a new alert id.
   */
  revision: string;
}

/**
 * What the bell needs: the feed, whether the last attempt failed, and a way to
 * ask again. `isError` with no alerts is a failure, not an all-clear — the panel
 * used to read both as "Todo en orden".
 */
export interface AlertsFeed {
  alerts: AppAlert[];
  isError: boolean;
  refetch: () => void;
}

/**
 * The alert feed is owned by the backend.
 *
 * The client used to derive it from four separate queries plus a role check, and
 * dropped the whole list whenever the session carried no organization object.
 * Now one tenant-scoped request answers it, visibility is decided on the server,
 * and the hook only asks again while the app is open.
 */
export function useAlerts(): AlertsFeed {
  const { user } = useAuth();

  // The payload is tenant-scoped, so the cache key must be too: after an
  // in-session organization switch the bell stays mounted, and a constant key
  // would keep serving the previous organization's alerts until the next refetch.
  // Without an organization scope there is nothing to ask for, so the query stays
  // disabled instead of sharing one fallback key across tenants.
  const organizationId = user?.organizationId;
  const enabled = Boolean(organizationId);

  const { data, isError, refetch } = useQuery({
    queryKey: ["alerts", organizationId ?? "none"],
    queryFn: () => api.get<AppAlert[]>("/alerts").then((res) => res.data),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // A 200 with an unexpected body (a proxy page, a legacy deploy) must not take
  // the whole chrome down: the bell renders the safe empty state instead. A
  // retained payload (react-query keeps the last data on a later error) keeps
  // being shown; only a failure with nothing to show surfaces as an error.
  return {
    alerts: Array.isArray(data) ? data : [],
    isError,
    refetch,
  };
}
