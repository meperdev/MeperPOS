// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";

/**
 * Security header verification for the Next.js frontend (issue #48, spec 2.R2).
 *
 * Asserts the exact header set that next.config.ts `headers()` applies to
 * every route (`/:path*`). The expected values are hard-coded below on
 * purpose: if someone removes or weakens a header in next.config.ts, this
 * spec fails and blocks merge in CI.
 *
 * The served-route counterpart (production build + `next start`) lives in
 * .github/workflows/ci.yml and checks the same six families on a real
 * response, guarding against build/deploy-time header loss.
 *
 * Extended for the 2026-10 security hardening spec (S3 / tasks T2 and T3):
 *  - the exact production Content-Security-Policy string (no `unsafe-eval`,
 *    no localhost origins) versus the development-only relaxation;
 *  - the opt-in `Content-Security-Policy-Report-Only` phase-2 variant;
 *  - `Cache-Control: no-store` scoped to the authenticated app routes, proven
 *    NOT to match `/login`, `/register`, `/_next/*` or static assets.
 */

interface HeaderEntry {
  key: string;
  value: string;
}

interface HeaderRule {
  source: string;
  headers: HeaderEntry[];
}

const ROUTE_SOURCE = "/:path*";

/** Headers asserted with an exact value (order-insensitive). */
const EXACT_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * The exact production policy. `'unsafe-inline'` STAYS in `script-src` because
 * the prerendered `/login` HTML carries three inline `<script>` blocks
 * (`id="_R_"` Turbopack chunk push, `self.__next_f` bootstrap and the ~7.6 KB
 * RSC flight payload); removing it breaks hydration. `'unsafe-eval'` is absent
 * because Next only needs it for dev HMR/source maps.
 */
const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://res.cloudinary.com; font-src 'self' data:; connect-src 'self' https://meperpos-api.up.railway.app; object-src 'none'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests";

/** Authenticated app-route prefixes derived from frontend/src/app/. */
const AUTHENTICATED_ROUTE_PREFIXES = [
  "admin",
  "categories",
  "customers",
  "dashboard",
  "expenses",
  "inventory",
  "pos",
  "profile",
  "purchase-orders",
  "reports",
  "sales",
  "settings",
  "suppliers",
  "tasks",
  "users",
];

/** Paths that MUST stay cacheable: public pages, static assets and `/`. */
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/_next/static/chunks/main.js",
  "/favicon.ico",
  "/logo.png",
  "/icon.svg",
  "/",
];

/** Next.js source patterns, matched with Next's own matcher for fidelity. */
function sourcesMatch(sources: string[], pathname: string): boolean {
  return sources.some((source) =>
    Boolean(
      getPathMatch(source, { removeUnnamedParams: true, strict: true })(
        pathname,
      ),
    ),
  );
}

/** Re-evaluate next.config.ts under a controlled environment. */
async function loadRules(env: Record<string, string>): Promise<HeaderRule[]> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  try {
    const mod = await import("../../next.config");
    const rules = (await mod.default.headers?.()) as HeaderRule[] | undefined;
    expect(rules).toBeDefined();
    return rules!;
  } finally {
    vi.unstubAllEnvs();
  }
}

function policyOf(rules: HeaderRule[], key: string): string | undefined {
  return rules
    .find((r) => r.source === ROUTE_SOURCE)
    ?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

function scriptSrcOf(policy: string): string {
  const directive = policy
    .split("; ")
    .find((part) => part.startsWith("script-src "));
  expect(directive).toBeDefined();
  return directive!;
}

describe("next.config.ts security headers (spec 2.R2)", () => {
  let routeHeaders: HeaderEntry[];

  beforeAll(async () => {
    const rules = (await nextConfig.headers?.()) as HeaderRule[] | undefined;
    expect(rules).toBeDefined();

    const rule = rules!.find((r) => r.source === ROUTE_SOURCE);
    expect(rule).toBeDefined();
    routeHeaders = rule!.headers;
  });

  function valueOf(header: string): string | undefined {
    return routeHeaders.find(
      (h) => h.key.toLowerCase() === header.toLowerCase(),
    )?.value;
  }

  it("applies headers to every route (source /:path*)", () => {
    expect(routeHeaders.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(EXACT_HEADERS))(
    "sets %s to the exact expected value",
    (header, expected) => {
      expect(valueOf(header)).toBe(expected);
    },
  );

  it("sets a non-empty Content-Security-Policy with default-src and frame-ancestors 'none'", () => {
    const csp = valueOf("content-security-policy");
    expect(csp).toBeDefined();
    expect(csp!.length).toBeGreaterThan(0);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("CSP phase 1 — sanitize without nonce (spec S3, task T2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits the exact production policy without unsafe-eval or dev origins", async () => {
    const rules = await loadRules({ NODE_ENV: "production", CSP_REPORT_ONLY: "" });
    const csp = policyOf(rules, "Content-Security-Policy");

    expect(csp).toBe(PRODUCTION_CSP);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("localhost");
    expect(csp).not.toContain("127.0.0.1");
  });

  it("keeps 'unsafe-inline' in script-src (proven required by /login inline scripts)", async () => {
    const rules = await loadRules({ NODE_ENV: "production", CSP_REPORT_ONLY: "" });
    const scriptSrc = scriptSrcOf(policyOf(rules, "Content-Security-Policy")!);

    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline'");
  });

  it("adds object-src, upgrade-insecure-requests, worker-src and manifest-src", async () => {
    const rules = await loadRules({ NODE_ENV: "production", CSP_REPORT_ONLY: "" });
    const csp = policyOf(rules, "Content-Security-Policy")!;

    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
  });

  it("keeps the pre-existing hardening directives and origins", async () => {
    const rules = await loadRules({ NODE_ENV: "production", CSP_REPORT_ONLY: "" });
    const csp = policyOf(rules, "Content-Security-Policy")!;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain(
      "img-src 'self' data: blob: https://res.cloudinary.com",
    );
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain(
      "connect-src 'self' https://meperpos-api.up.railway.app",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("relaxes unsafe-eval and localhost origins in development only", async () => {
    const rules = await loadRules({
      NODE_ENV: "development",
      CSP_REPORT_ONLY: "",
    });
    const csp = policyOf(rules, "Content-Security-Policy")!;

    expect(scriptSrcOf(csp)).toBe(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
    expect(csp).toContain("http://localhost:3001");
    expect(csp).toContain("http://127.0.0.1:3001");
  });

  it("omits upgrade-insecure-requests in development so the loopback API is not rewritten to https", async () => {
    const rules = await loadRules({
      NODE_ENV: "development",
      CSP_REPORT_ONLY: "",
    });
    const csp = policyOf(rules, "Content-Security-Policy")!;

    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("still exports a plain static header set (no per-request / nonce machinery)", async () => {
    const rules = await loadRules({ NODE_ENV: "production", CSP_REPORT_ONLY: "" });

    // Two calls with the same env must produce identical, serializable rules:
    // a nonce-based policy would be response-specific and cannot be a constant.
    const again = await loadRules({ NODE_ENV: "production", CSP_REPORT_ONLY: "" });
    expect(again).toEqual(rules);
    expect(policyOf(rules, "Content-Security-Policy")).not.toContain("nonce-");
  });
});

describe("CSP phase 2 report-only variant (spec S3, task T2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF by default: no report-only header in production", async () => {
    const rules = await loadRules({ NODE_ENV: "production", CSP_REPORT_ONLY: "" });

    expect(
      policyOf(rules, "Content-Security-Policy-Report-Only"),
    ).toBeUndefined();
  });

  it("is enabled by CSP_REPORT_ONLY=true and drops unsafe-inline from script-src", async () => {
    const rules = await loadRules({
      NODE_ENV: "production",
      CSP_REPORT_ONLY: "true",
    });
    const reportOnly = policyOf(rules, "Content-Security-Policy-Report-Only");

    expect(reportOnly).toBeDefined();
    const scriptSrc = scriptSrcOf(reportOnly!);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("leaves the enforced production policy untouched when report-only is on", async () => {
    const rules = await loadRules({
      NODE_ENV: "production",
      CSP_REPORT_ONLY: "true",
    });

    expect(policyOf(rules, "Content-Security-Policy")).toBe(PRODUCTION_CSP);
  });

  it("keeps the production API origin in the report-only connect-src", async () => {
    const rules = await loadRules({
      NODE_ENV: "production",
      CSP_REPORT_ONLY: "true",
    });
    const reportOnly = policyOf(rules, "Content-Security-Policy-Report-Only")!;

    expect(reportOnly).toContain(
      "connect-src 'self' https://meperpos-api.up.railway.app",
    );
    expect(reportOnly).not.toContain("localhost");
  });
});

describe("Cache-Control: no-store on authenticated routes (spec S3, task T3)", () => {
  let noStoreSources: string[];

  beforeAll(async () => {
    const rules = (await nextConfig.headers?.()) as HeaderRule[] | undefined;
    expect(rules).toBeDefined();
    noStoreSources = rules!
      .filter((rule) =>
        rule.headers.some(
          (h) =>
            h.key.toLowerCase() === "cache-control" &&
            h.value.toLowerCase().includes("no-store"),
        ),
      )
      .map((rule) => rule.source);
  });

  it("declares a no-store rule", () => {
    expect(noStoreSources.length).toBeGreaterThan(0);
  });

  it("matches every authenticated prefix, bare and nested", () => {
    for (const prefix of AUTHENTICATED_ROUTE_PREFIXES) {
      expect(sourcesMatch(noStoreSources, `/${prefix}`)).toBe(true);
      expect(sourcesMatch(noStoreSources, `/${prefix}/nested/path`)).toBe(true);
    }
  });

  it("never matches /login, /register, /_next/*, static assets or /", () => {
    for (const pathname of PUBLIC_PATHS) {
      expect(sourcesMatch(noStoreSources, pathname)).toBe(false);
    }
  });

  it("covers exactly the authenticated app-tree prefixes and no others", () => {
    const covered = noStoreSources
      .map((source) => source.replace(/^\//, "").replace(/\/:path\*$/, ""))
      .sort();

    expect(covered).toEqual([...AUTHENTICATED_ROUTE_PREFIXES].sort());
  });

  it("does not attach no-store to the global /:path* rule", () => {
    const globalRule = noStoreSources.includes(ROUTE_SOURCE);
    expect(globalRule).toBe(false);
  });
});
