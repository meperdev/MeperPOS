import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { api, type PosRequestScope } from "@/lib/api";
import {
  readOrganizationScope,
  subscribeOrganizationScope,
} from "@/lib/organizationScope";

export interface PosSite {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface PosSiteContext {
  locations: PosSite[];
  checkoutLocationId: string | null;
}

const noOrganization = () => null;

/**
 * The organization the SuperAdmin POS is looking at. A cross-tab change resets
 * the shared query cache before the new scope is exposed, so rows fetched for
 * the previous organization can never be read under the new one.
 */
export function usePosOrganizationScope(isSuperAdmin: boolean) {
  const client = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!isSuperAdmin) return () => {};
      return subscribeOrganizationScope(listener, () => {
        // The API now reads the new organization from storage. Reset the shared
        // product/customer queries before exposing that scope in this tab.
        void client.resetQueries();
      });
    },
    [client, isSuperAdmin],
  );
  return useSyncExternalStore(
    subscribe,
    isSuperAdmin ? readOrganizationScope : noOrganization,
    noOrganization,
  );
}

/**
 * The server decides which accessible site, if any, may charge. The POS only
 * reads that answer; it never promotes a visible site into a checkout grant.
 *
 * The read is bound to the rendered user and tenant: the query key describes the
 * surface, so the request that fills it must leave under the same identity.
 */
export function usePosSiteContext(userId: string, organizationId: string) {
  const scope = useMemo<PosRequestScope>(
    () => ({ userId, organizationId }),
    [userId, organizationId],
  );
  return useQuery({
    queryKey: ["pos-site-context", userId, organizationId],
    queryFn: ({ signal }) =>
      api
        .get<PosSiteContext>(
          "/locations/pos-context",
          undefined,
          { signal, posScope: scope },
        )
        .then(({ data }) => data),
    // Eligibility must be verified for THIS mount, never reused from a cache
    // populated by a previous user, organization or site.
    refetchOnMount: "always",
    staleTime: 0,
    gcTime: 0,
  });
}
