import { describe, expect, it } from "vitest";

import {
  API_PATH_PREFIX,
  MissingBackendOriginError,
  apiProxyRewrites,
  assertProxyConfigured,
  isRelativeApiBase,
  normalizeBackendOrigin,
  proxyDestination,
} from "@/lib/api-proxy";

const RAILWAY = "https://meperpos-api.up.railway.app";

describe("relative API base detection", () => {
  it("recognises a same-origin base", () => {
    expect(isRelativeApiBase("/api")).toBe(true);
    expect(isRelativeApiBase("  /api  ")).toBe(true);
  });

  it("recognises an absolute base", () => {
    expect(isRelativeApiBase(`${RAILWAY}/api`)).toBe(false);
    expect(isRelativeApiBase("http://localhost:3001/api")).toBe(false);
  });

  it("treats an unset base as not relative, so a bare environment is not failed", () => {
    expect(isRelativeApiBase(undefined)).toBe(false);
    expect(isRelativeApiBase("")).toBe(false);
  });
});

describe("backend origin normalisation", () => {
  it("strips trailing slashes so the destination never doubles up", () => {
    expect(normalizeBackendOrigin(`${RAILWAY}/`)).toBe(RAILWAY);
    expect(normalizeBackendOrigin(`${RAILWAY}///`)).toBe(RAILWAY);
  });

  it("reports a missing origin as null", () => {
    expect(normalizeBackendOrigin(undefined)).toBeNull();
    expect(normalizeBackendOrigin("")).toBeNull();
    expect(normalizeBackendOrigin("   ")).toBeNull();
  });
});

describe("api proxy rewrites", () => {
  it("publishes nothing when no origin is configured", () => {
    expect(apiProxyRewrites(undefined)).toEqual([]);
    expect(apiProxyRewrites("")).toEqual([]);
  });

  it("routes the whole /api subtree to the configured origin", () => {
    const rewrites = apiProxyRewrites(`${RAILWAY}/`);

    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].source).toBe(`${API_PATH_PREFIX}/:path*`);
    expect(rewrites[0].destination).toBe(`${RAILWAY}${API_PATH_PREFIX}/:path*`);
    expect(proxyDestination(RAILWAY)).toBe(`${RAILWAY}/api/:path*`);
  });
});

describe("half-configured deployments", () => {
  it("stops the build when the client is relative but nothing proxies it", () => {
    // Without this, the app builds, loads, and then fails every request against
    // a static host that has no /api routes at all.
    expect(() =>
      assertProxyConfigured({ apiUrl: "/api", backendOrigin: undefined }),
    ).toThrow(MissingBackendOriginError);

    expect(() =>
      assertProxyConfigured({ apiUrl: "/api", backendOrigin: "  " }),
    ).toThrow(MissingBackendOriginError);
  });

  it("accepts the exact pair production is documented to set", () => {
    expect(() =>
      assertProxyConfigured({ apiUrl: "/api", backendOrigin: RAILWAY }),
    ).not.toThrow();
  });

  it("accepts direct mode, which needs no proxy", () => {
    expect(() =>
      assertProxyConfigured({
        apiUrl: "http://localhost:3001/api",
        backendOrigin: undefined,
      }),
    ).not.toThrow();
  });

  it("accepts an unconfigured environment, which resolves against the page origin", () => {
    expect(() =>
      assertProxyConfigured({ apiUrl: undefined, backendOrigin: undefined }),
    ).not.toThrow();
  });
});
