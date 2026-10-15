import path from "node:path";
import type { NextConfig } from "next";
import { apiProxyRewrites, assertProxyConfigured } from "./src/lib/api-proxy";

// A relative NEXT_PUBLIC_API_URL is only correct when this deployment also
// proxies /api/* to the backend. Getting that pair half-configured does not
// degrade: it ships an app that loads and then fails every request. Failing the
// build here is the cheapest possible moment to find out.
assertProxyConfigured({
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  backendOrigin: process.env.BACKEND_ORIGIN,
});

// Security headers applied to every route.
// 'unsafe-inline' and 'unsafe-eval' are kept for Next.js runtime compatibility
// (inline bootstrap scripts, dev HMR); they can be tightened later with nonces.
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
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://res.cloudinary.com; font-src 'self' data:; connect-src 'self' https://meperpos-api.up.railway.app http://localhost:3001 http://127.0.0.1:3001; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

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
  /**
   * Same-origin API proxy.
   *
   * WebKit blocks third-party cookies outright, so in direct mode the httpOnly
   * refresh cookie never comes back from the API origin and an installed app
   * asks for a login on every launch. Serving the API under this origin makes
   * those cookies first-party. Registered only when BACKEND_ORIGIN is set, so
   * local development and direct mode stay untouched.
   */
  async rewrites() {
    return apiProxyRewrites(process.env.BACKEND_ORIGIN);
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
