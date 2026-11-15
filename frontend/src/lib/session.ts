import { safeRemoveItem } from "@/lib/utils";
import { clearSessionPageCache } from "@/lib/pwa";

/**
 * In-memory access token store.
 *
 * The access token lives ONLY in this module-scoped variable. It never
 * touches localStorage, sessionStorage, or document.cookie, so XSS cannot
 * exfiltrate persistent credentials. A full page reload intentionally loses
 * the token; AuthContext restores the session silently through the httpOnly
 * refresh_token cookie (POST /auth/refresh).
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

/**
 * localStorage keys holding session-scoped client state. Neither is a
 * credential: `user` is a display cache and `selectedOrganizationId` scopes the
 * SuperAdmin view. Both belong to the session rather than to the browser.
 */
export const USER_DISPLAY_CACHE_KEY = "user";
export const SELECTED_ORGANIZATION_KEY = "selectedOrganizationId";

/**
 * The single owner of session teardown.
 *
 * Two code paths end a session: `AuthContext.logout` when the operator signs
 * out, and the request layer's dead-session branch when the refresh fails. Both
 * must leave the same residue behind — no in-memory token, no user display
 * cache, no organization scope for the next login to inherit and send as
 * `X-Organization-Id`, and no service-worker record of which screens this
 * session opened. One function here means neither path can forget one of them.
 *
 * The React Query cache is deliberately not cleared here. It is the other half
 * of the same boundary, but this module must not depend on React Query, so
 * `AuthContext.logout` clears it alongside this call.
 */
export function clearSessionState(): void {
  clearAccessToken();
  safeRemoveItem(USER_DISPLAY_CACHE_KEY);
  safeRemoveItem(SELECTED_ORGANIZATION_KEY);
  clearSessionPageCache();
}
