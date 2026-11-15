import { afterEach, describe, expect, it, vi } from "vitest";

import { checkPwaSurface, runCli } from "./check-pwa.mjs";

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
    '<link rel="stylesheet" href="/_next/static/chunks/app.css">',
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
    "/_next/static/chunks/app.css": () =>
      new Response(
        overrides.css ??
          ":root{--safe-top:env(safe-area-inset-top,0px);--safe-bottom:env(safe-area-inset-bottom,0px);--mobile-header:3.5rem}body{overscroll-behavior:none;-webkit-tap-highlight-color:transparent}button{touch-action:manipulation}.pt-\\[calc\\(var\\(--mobile-header\\)\\)\\]{padding-top:calc(var(--mobile-header) + 1rem)}",
        { status: 200, headers: { "content-type": "text/css" } }
      ),
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

  /**
   * The Apple tag contains the generic name, so a substring check reports
   * success on a page that only carries the Apple one. This is the vacuity the
   * first version shipped with, pinned so it cannot come back.
   */
  it("reports a page that carries only the Apple capability tag", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({ html: html({ legacy: false }) }),
      base: BASE,
    });

    expect(checks(failures)).toContain("/login markup");
    expect(
      failures.some((f) => f.detail.includes('missing "mobile-web-app-capable"'))
    ).toBe(true);
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

describe("checkPwaSurface — built stylesheet", () => {
  it("reports a stylesheet that lost the safe-area tokens", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({ css: ":root{--primary:#000}" }),
      base: BASE,
    });

    expect(checks(failures)).toContain("built stylesheet");
    expect(failures.some((f) => f.detail.includes("safe-area top"))).toBe(true);
  });

  it("reports a page with no stylesheet link at all", async () => {
    const failures = await checkPwaSurface({
      fetchImpl: transport({
        html: '<html><head><link rel="manifest" href="/manifest.webmanifest"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"></head></html>',
      }),
      base: BASE,
    });

    expect(failures.some((f) => f.detail.includes("no stylesheet link"))).toBe(
      true
    );
  });
});

/**
 * The half CI actually reads. A guard that prints failures and exits 0 is the
 * same vacuous class this whole task exists to close.
 */
describe("runCli exit code", () => {
  function cli(overrides = {}) {
    const lines = [];
    const log = {
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    };
    return {
      lines,
      promise: runCli({
        fetchImpl: transport(overrides.transport),
        env: {},
        findFreePortImpl: async () => "3123",
        waitForServerImpl: overrides.waitForServerImpl ?? (async () => true),
        spawnImpl:
          overrides.spawnImpl ??
          (() => ({
            // `exit` resolves immediately: the real `waitForExit` has a 5s
            // backstop and a fake child that never exits would spend it.
            once: (event, handler) => {
              if (event === "exit") handler();
            },
            kill: () => undefined,
            on: () => undefined,
          })),
        log,
        ...overrides.rest,
      }),
    };
  }

  it("exits 0 on a clean surface", async () => {
    const { promise } = cli();
    await expect(promise).resolves.toBe(0);
  });

  it("exits 1 when a check fails", async () => {
    const { promise, lines } = cli({
      transport: { manifest: manifest({ display: "browser" }) },
    });

    await expect(promise).resolves.toBe(1);
    expect(lines.some((line) => line.includes("display"))).toBe(true);
  });

  it("exits 1 when the app never answers", async () => {
    const { promise, lines } = cli({ waitForServerImpl: async () => false });

    await expect(promise).resolves.toBe(1);
    expect(lines.some((line) => line.includes("never answered"))).toBe(true);
  });

  it("exits 1 when the app cannot be spawned at all", async () => {
    const { promise } = cli({
      spawnImpl: () => {
        throw new Error("npx missing");
      },
    });

    await expect(promise).resolves.toBe(1);
  });
});
