import path from "path";
import type { NextConfig } from "next";

/**
 * Content-Security-Policy parts (spec S3, "sanitize without nonce", phase 1).
 *
 * The enforcing policy is a plain static header set: it contains no nonce and
 * is exported as a build-time constant, so `/login` stays prerendered and the
 * CDN cache keeps its `x-nextjs-cache: HIT`. A nonce would require dynamic
 * rendering on every route, which S3 explicitly forbids in phase 1. The strict
 * phase-2 shape is exposed separately as an opt-in `Report-Only` header so
 * violations can be collected before enforcement.
 */

const RAILWAY_API_ORIGIN = "https://meperpos-api.up.railway.app";
const CLOUDINARY_ORIGIN = "https://res.cloudinary.com";
const DEV_API_ORIGINS = [
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:3004",
  "http://127.0.0.1:3004",
] as const;

const isProduction = process.env.NODE_ENV === "production";

/** Opt-in phase-2 collection; default OFF so production headers are unchanged. */
const isReportOnlyEnabled =
  process.env.CSP_REPORT_ONLY === "true" || process.env.CSP_REPORT_ONLY === "1";

/** Fixed serialization order for every policy variant. */
const CSP_DIRECTIVE_ORDER = [
  "default-src",
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "connect-src",
  "object-src",
  "worker-src",
  "manifest-src",
  "frame-ancestors",
  "base-uri",
  "form-action",
  "upgrade-insecure-requests",
] as const;

type CspDirective = (typeof CSP_DIRECTIVE_ORDER)[number];

/** Directives shared by the enforcing (phase 1) and report-only (phase 2) policies. */
const CSP_COMMON_SOURCES: Partial<Record<CspDirective, readonly string[]>> = {
  "default-src": ["'self'"],
  // Next injects inline <style> for styled-jsx/layout; inline styles are not
  // the S3 concern (the concern is inline script), so this stays.
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:", CLOUDINARY_ORIGIN],
  "font-src": ["'self'", "data:"],
  "object-src": ["'none'"],
  // No Web/Service Worker exists in the app, so `blob:` is NOT needed here.
  // The `blob:` usages are image previews (`img-src`) and a download anchor
  // (`URL.createObjectURL`), neither of which is governed by `worker-src`.
  "worker-src": ["'self'"],
  "manifest-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
};

/**
 * `'unsafe-inline'` in `script-src` is PROVEN required in phase 1: the
 * prerendered `/login` HTML contains three inline `<script>` blocks —
 * `id="_R_"` (Turbopack/TURBOPACK chunk push), `self.__next_f=self.__next_f||[]`
 * and the ~7.6 KB RSC flight payload. They live in the static HTML, so they
 * cannot carry a nonce without forcing dynamic rendering. Removing
 * `'unsafe-inline'` would break hydration; do not remove it in phase 1.
 *
 * `'unsafe-eval'` is a development-only need (HMR and eval-based source maps),
 * so it is emitted only when `NODE_ENV !== "production"`.
 */
const ENFORCED_SCRIPT_SRC: readonly string[] = isProduction
  ? ["'self'", "'unsafe-inline'"]
  : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

/**
 * Production must reach only itself and the Railway API. The localhost
 * origins are a development convenience and must never leak into production.
 */
const CONNECT_SRC: readonly string[] = isProduction
  ? ["'self'", RAILWAY_API_ORIGIN]
  : ["'self'", RAILWAY_API_ORIGIN, ...DEV_API_ORIGINS];

/**
 * Phase-2 strict shape: no `'unsafe-inline'`. A nonce cannot live in a static
 * header, so the enforced phase 2 will inject `'nonce-…'` per response while
 * `'strict-dynamic'` keeps Next's own bootstrap chain working. This variant is
 * shipped Report-Only first (S3: "Prueba primero las políticas restrictivas
 * con CSP Report-Only").
 */
const PHASE_2_SCRIPT_SRC: readonly string[] = ["'self'", "'strict-dynamic'"];

/**
 * `upgrade-insecure-requests` is production-only on purpose. It rewrites every
 * a-priori-insecure subresource URL to `https://`; keeping it out of the
 * development policy guarantees the local API at `http://localhost:3001`
 * cannot be upgraded by a browser that does not exempt loopback origins.
 */
const PRODUCTION_ONLY_DIRECTIVES: Partial<
  Record<CspDirective, readonly string[]>
> = isProduction ? { "upgrade-insecure-requests": [] } : {};

function buildCsp(
  overrides: Partial<Record<CspDirective, readonly string[]>>,
): string {
  return CSP_DIRECTIVE_ORDER.flatMap((directive) => {
    const sources = overrides[directive] ?? CSP_COMMON_SOURCES[directive];
    // `undefined` means "omit the directive"; an empty array means a valueless
    // directive such as `upgrade-insecure-requests` that must be emitted bare.
    if (sources === undefined) return [];
    return [
      sources.length > 0 ? `${directive} ${sources.join(" ")}` : directive,
    ];
  }).join("; ");
}

/** The enforcing phase-1 policy (production ignores the dev-only relaxations). */
const CONTENT_SECURITY_POLICY = buildCsp({
  "script-src": ENFORCED_SCRIPT_SRC,
  "connect-src": CONNECT_SRC,
  ...PRODUCTION_ONLY_DIRECTIVES,
});

/** Opt-in phase-2 collection policy; never blocks. */
const CONTENT_SECURITY_POLICY_REPORT_ONLY = buildCsp({
  "script-src": PHASE_2_SCRIPT_SRC,
  "connect-src": CONNECT_SRC,
  ...PRODUCTION_ONLY_DIRECTIVES,
});

// Security headers applied to every route.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: CONTENT_SECURITY_POLICY,
  },
];

/**
 * Authenticated app-route prefixes, derived from `frontend/src/app/`
 * (every top-level directory except the public `login`/`register`, the root
 * `page.tsx`, and the non-route asset files). Route groups such as
 * `settings/(advanced)` do not change the URL and are covered by the prefix.
 *
 * `/:path*` matches the bare prefix and every nested path (verified against
 * Next's own `getPathMatch`), so one source per prefix is enough.
 */
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
] as const;

/** Sensitive, per-user routes must not be cached by browsers or the CDN. */
const NO_STORE_HEADER = { key: "Cache-Control", value: "no-store" };

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(),
  },
  reactCompiler: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "@tanstack/react-query"],
  },
  images: {
    // Custom Cloudinary loader: the backend stores the original Cloudinary URL
    // (no width/format/quality transforms), so pushing all delivery transforms
    // to Cloudinary's edge CDN and bypassing the Next.js optimizer avoids
    // re-transcoding every image on a single Next server. See
    // src/lib/image-loader.ts for the transform chain.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  async headers() {
    const globalHeaders = isReportOnlyEnabled
      ? [
          ...securityHeaders,
          {
            key: "Content-Security-Policy-Report-Only",
            value: CONTENT_SECURITY_POLICY_REPORT_ONLY,
          },
        ]
      : securityHeaders;

    return [
      {
        source: "/:path*",
        headers: globalHeaders,
      },
      ...AUTHENTICATED_ROUTE_PREFIXES.map((prefix) => ({
        source: `/${prefix}/:path*`,
        headers: [NO_STORE_HEADER],
      })),
    ];
  },
};

export default nextConfig;
