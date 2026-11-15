/**
 * Same-origin `/api` proxy configuration for the deployed frontend.
 *
 * The browser and the API sit on different origins (Vercel and Railway). WebKit
 * blocks third-party cookies outright, so the httpOnly refresh cookie never
 * comes back and an installed app asks for a login on every launch. Routing the
 * API through this origin makes those cookies first-party.
 *
 * Kept here, dependency-free, so the decision is testable without evaluating
 * the Next config, and so `next.config.ts` can import it with a relative path
 * (Next does not apply the `@/` alias to its own config file).
 */

export const API_PATH_PREFIX = "/api";

/**
 * True when the client is configured to call its own origin rather than an
 * absolute API host.
 */
export function isRelativeApiBase(apiUrl: string | undefined): boolean {
  return (apiUrl ?? "").trim().startsWith("/");
}

/** Strips trailing slashes, and reports the absence of an origin as `null`. */
export function normalizeBackendOrigin(
  backendOrigin: string | undefined,
): string | null {
  const trimmed = (backendOrigin ?? "").trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

/** The rewrite destination for the proxy. */
export function proxyDestination(backendOrigin: string): string {
  return `${backendOrigin}${API_PATH_PREFIX}/:path*`;
}

export class MissingBackendOriginError extends Error {
  constructor() {
    super(
      "NEXT_PUBLIC_API_URL is relative, but BACKEND_ORIGIN is not set. Every " +
        "API call would 404 against the static host. Set BACKEND_ORIGIN to the " +
        "API origin (for example https://meperpos-api.up.railway.app), or point " +
        "NEXT_PUBLIC_API_URL at the API directly.",
    );
    this.name = "MissingBackendOriginError";
  }
}

/**
 * Refuses a half-configured deployment.
 *
 * A relative `NEXT_PUBLIC_API_URL` is only correct when this deployment also
 * proxies `/api/*`. Getting that wrong does not degrade: it produces an app
 * that loads and then fails every request. Failing the build is the cheapest
 * possible moment to find out.
 */
export function assertProxyConfigured(input: {
  apiUrl?: string;
  backendOrigin?: string;
}): void {
  if (
    isRelativeApiBase(input.apiUrl) &&
    normalizeBackendOrigin(input.backendOrigin) === null
  ) {
    throw new MissingBackendOriginError();
  }
}

/** The rewrite list this deployment should publish. */
export function apiProxyRewrites(backendOrigin: string | undefined) {
  const origin = normalizeBackendOrigin(backendOrigin);
  if (origin === null) return [];
  return [
    {
      source: `${API_PATH_PREFIX}/:path*`,
      destination: proxyDestination(origin),
    },
  ];
}
