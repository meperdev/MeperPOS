import { afterEach, describe, expect, it, vi } from "vitest";

import { checkPwaSurface } from "./check-pwa.mjs";

const BASE = "http://127.0.0.1:3101";

function manifest(overrides = {}) {
  return {
    name: "MeperPOS",
    short_name: "MeperPOS",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#0f766e",
    background_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    ...overrides,
  };
}

const workerBody = `
self.addEventListener("install", () => {});
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", () => {});
`;

function html({ apple = true, legacy = true, manifestLink = true } = {}) {
  return [
    "<html><head>",
    manifestLink ? '<link rel="manifest" href="/manifest.webmanifest">' : "",
    legacy ? '<meta name="mobile-web-app-capable" content="yes">' : "",
    apple ? '<meta name="apple-mobile-web-app-capable" content="yes">' : "",
    "</head><body></body></html>",
  ].join("");
}

/**
 * Fake transport: every expectation below is about what the guard does with a
 * response, so the guard is tested without booting a server.
 */
function transport(overrides = {}) {
  const routes = {
    "/manifest.webmanifest": () =>
      new Response(JSON.stringify(overrides.manifest ?? manifest()), {
        status: 200,
        headers: { "content-type": "application/manifest+json" },
      }),
    "/sw.js": () =>
      new Response(overrides.workerBody ?? workerBody, {
        status: 200,
        headers: { "content-type": "text/javascript; charset=UTF-8" },
      }),
    "/login": () =>
      new Response(overrides.html ?? html(), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    "/offline": () => new Response("<html></html>", { status: 200 }),
    ...overrides.routes,
  };

  return vi.fn(async (url) => {
    const { pathname } = new URL(url.toString());
    const route = routes[pathname];
    if (!route) throw new Error(`no route for ${pathname}`);
    return route();
  });
}

const checks = (failures) => failures.map((failure) => failure.check);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkPwaSurface", () => {
  it("passes an intact surface", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport(),
      base: BASE,
    });

    expect(failures).toEqual([]);
  });

  it("reports a missing manifest field", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({
        manifest: manifest({ background_color: undefined }),
      }),
      base: BASE,
    });

    expect(checks(failures)).toContain("/manifest.webmanifest field");
    // The name has to identify WHICH field, or the failure costs a manual diff.
    expect(failures[0].detail).toContain("background_color");
  });

  it("reports a manifest that is no longer standalone", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({ manifest: manifest({ display: "browser" }) }),
      base: BASE,
    });

    expect(checks(failures)).toContain("/manifest.webmanifest display");
  });

  it("reports a missing icon size", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({
        manifest: manifest({
          icons: [{ src: "/icons/icon-512.png", sizes: "512x512" }],
        }),
      }),
      base: BASE,
    });

    expect(failures.some((f) => f.detail.includes("192x192"))).toBe(true);
  });

  it("reports a manifest with no maskable icon", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({
        manifest: manifest({
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192" },
            { src: "/icons/icon-512.png", sizes: "512x512" },
          ],
        }),
      }),
      base: BASE,
    });

    expect(failures.some((f) => f.detail.includes("maskable"))).toBe(true);
  });

  it("reports a worker served as the wrong content type", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({
        routes: {
          "/sw.js": () =>
            new Response(workerBody, {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
        },
      }),
      base: BASE,
    });

    expect(checks(failures)).toContain("/sw.js type");
  });

  it("reports a worker still shipping the silent takeover", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({
        workerBody: 'self.addEventListener("fetch", () => {});',
      }),
      base: BASE,
    });

    expect(checks(failures)).toContain("/sw.js body");
    expect(failures.some((f) => f.detail.includes("SKIP_WAITING"))).toBe(true);
  });

  it("does not accept a worker that only mentions SKIP_WAITING in a comment", async () => {
    // The first version of this check looked for the token, and the file's own
    // commentary satisfied it: the guard passed on a worker that never read the
    // message. This is that regression, pinned.
    const failures = await checkPwaSurface({
      fetchImpl: transport({
        workerBody: [
          "/** A new version waits for a SKIP_WAITING message. */",
          'self.addEventListener("fetch", () => {});',
        ].join("\n"),
      }),
      base: BASE,
    });

    expect(failures.some((f) => f.detail.includes("does not read"))).toBe(true);
  });

  it("reports a worker with no message handler at all", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({
        workerBody: 'self.addEventListener("fetch", () => {});',
      }),
      base: BASE,
    });

    expect(failures.some((f) => f.detail.includes("no message handler"))).toBe(
      true
    );
  });

  it("reports a served page that lost the Apple capability tag", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({ html: html({ apple: false }) }),
      base: BASE,
    });

    expect(failures.some((f) => f.detail.includes("apple-mobile-web-app"))).toBe(
      true
    );
  });

  it("reports a served page with no manifest link", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({ html: html({ manifestLink: false }) }),
      base: BASE,
    });

    expect(failures.some((f) => f.detail.includes("manifest link"))).toBe(true);
  });

  it("reports an unreachable server instead of exiting clean", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
      base: BASE,
    });

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0].detail).toContain("ECONNREFUSED");
  });

  it("reports a non-2xx manifest response", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({
        routes: {
          "/manifest.webmanifest": () => new Response("nope", { status: 404 }),
        },
      }),
      base: BASE,
    });

    expect(checks(failures)).toContain("/manifest.webmanifest status");
  });
});
