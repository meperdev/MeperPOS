import type { QueryClient } from "@tanstack/react-query";
import { SELECTED_ORGANIZATION_KEY } from "@/lib/session";
import { safeRemoveItem, safeSetItem } from "@/lib/utils";

/**
 * Applies a SuperAdmin organization scope change.
 *
 * A scope change must RESET the queries: not clear them, and not merely
 * invalidate them.
 *
 * - Invalidating leaves the previous organization's rows readable while the
 *   refetch resolves.
 * - Clearing empties the cache but leaves a MOUNTED observer holding its last
 *   result, and unlike invalidating it requests no refetch at all, so those rows
 *   can stay on screen indefinitely.
 *
 * `resetQueries` drops the displayed state AND refetches the active queries,
 * which is also how the switcher's own organization list comes back.
 */
export function applyOrganizationScope(
  queryClient: QueryClient,
  organizationId: string | null,
): void {
  if (organizationId) {
    safeSetItem(SELECTED_ORGANIZATION_KEY, organizationId);
  } else {
    safeRemoveItem(SELECTED_ORGANIZATION_KEY);
  }
  void queryClient.resetQueries();
}
