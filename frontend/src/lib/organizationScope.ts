import type { QueryClient } from "@tanstack/react-query";
import { SELECTED_ORGANIZATION_KEY } from "@/lib/session";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/utils";

const SCOPE_CHANGED = "meperpos:organization-scope-changed";
const SCOPE_CHANGE_REQUESTED = "meperpos:organization-scope-change-requested";

/**
 * Registers a veto for an imminent organization scope change. The caller gets
 * the release function; while installed, a request that `canSwitch` rejects is
 * cancelled before storage or cached rows are touched.
 */
export function guardOrganizationScopeChange(canSwitch: () => boolean): () => void {
  const guard = (event: Event) => {
    if (!canSwitch()) event.preventDefault();
  };
  window.addEventListener(SCOPE_CHANGE_REQUESTED, guard);
  return () => window.removeEventListener(SCOPE_CHANGE_REQUESTED, guard);
}

/** A cancelable request tells every installed veto that a switch is pending. */
export function canChangeOrganizationScope(): boolean {
  return typeof window === "undefined" || window.dispatchEvent(
    new Event(SCOPE_CHANGE_REQUESTED, { cancelable: true }),
  );
}

export function readOrganizationScope(): string | null {
  return safeGetItem(SELECTED_ORGANIZATION_KEY);
}

/**
 * Subscribes to same-tab and cross-tab scope changes. `beforeCrossTabChange`
 * runs before the new scope is exposed, so a query cache reset can drop rows
 * fetched for the organization that is leaving.
 */
export function subscribeOrganizationScope(
  listener: () => void,
  beforeCrossTabChange?: () => void,
): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SELECTED_ORGANIZATION_KEY) return;
    beforeCrossTabChange?.();
    listener();
  };
  window.addEventListener(SCOPE_CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SCOPE_CHANGED, listener);
    window.removeEventListener("storage", onStorage);
  };
}

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
): boolean {
  // Selecting the scope the session already has is not a change. Rewriting the
  // stored value would reset every query — dropping a mounted POS workspace and
  // its cart — for a scope that never moved, and there is nothing to veto.
  if (organizationId === readOrganizationScope()) return true;

  if (!canChangeOrganizationScope()) {
    return false;
  }

  if (organizationId) {
    safeSetItem(SELECTED_ORGANIZATION_KEY, organizationId);
  } else {
    safeRemoveItem(SELECTED_ORGANIZATION_KEY);
  }
  void queryClient.resetQueries();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SCOPE_CHANGED));
  return true;
}
