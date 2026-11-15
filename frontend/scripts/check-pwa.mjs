#!/usr/bin/env node
/**
 * Served-route guard for the PWA surface.
 *
 * Config unit tests cannot see build-time loss: Next can drop a metadata tag,
 * stop emitting the manifest route, or fail to copy the worker into the build
 * while every source-level assertion stays green. This checks what a real HTTP
 * response carries, the same way the security-header step does.
 *
 * The logic is exported separately from the CLI so the assertions themselves
 * can be tested with a fake transport instead of a running server.
 */

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const MANIFEST_FIELDS = [
  "name",
  "short_name",
  "start_url",
  "scope",
  "theme_color",
  "background_color",
];

const REQUIRED_ICON_SIZES = ["192x192", "512x512"];

const CAPABILITY_TAGS = [
  "mobile-web-app-capable",
  "apple-mobile-web-app-capable",
];

async function readText(response) {
  return response.text();
}

/**
 * Returns one entry per failed expectation. An empty array means the deployed
 * shape is intact.
 */
export async function checkPwaSurface({ fetchImpl, base }) {
  const failures = [];
  const fail = (check, detail) => failures.push({ check, detail });

  const get = async (pathname) => {
    try {
      return await fetchImpl(new URL(pathname, base));
    } catch (error) {
      fail(`${pathname} reachable`, String(error));
      return null;
    }
  };

  const manifestResponse = await get("/manifest.webmanifest");
  if (manifestResponse) {
    if (!manifestResponse.ok) {
      fail("/manifest.webmanifest status", `HTTP ${manifestResponse.status}`);
    }
    const contentType = manifestResponse.headers.get("content-type") ?? "";
    if (!/manifest\+json|application\/json/.test(contentType)) {
      fail("/manifest.webmanifest type", `content-type was "${contentType}"`);
    }

    let manifest;
    try {
      manifest = JSON.parse(await readText(manifestResponse));
    } catch (error) {
      fail("/manifest.webmanifest body", `not JSON: ${String(error)}`);
    }

    if (manifest) {
      for (const field of MANIFEST_FIELDS) {
        if (manifest[field] === undefined || manifest[field] === "") {
          fail("/manifest.webmanifest field", `missing "${field}"`);
        }
      }

      if (manifest.display !== "standalone") {
        fail(
          "/manifest.webmanifest display",
          `expected "standalone", got "${String(manifest.display)}"`
        );
      }

      const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
      for (const size of REQUIRED_ICON_SIZES) {
        if (!icons.some((icon) => icon?.sizes === size)) {
          fail("/manifest.webmanifest icons", `missing a ${size} icon`);
        }
      }
      if (
        !icons.some((icon) =>
          String(icon?.purpose ?? "")
            .split(/\s+/)
            .includes("maskable")
        )
      ) {
        fail("/manifest.webmanifest icons", "no maskable icon");
      }
    }
  }

  const workerResponse = await get("/sw.js");
  if (workerResponse) {
    if (!workerResponse.ok) {
      fail("/sw.js status", `HTTP ${workerResponse.status}`);
    }
    const contentType = workerResponse.headers.get("content-type") ?? "";
    if (!/javascript/.test(contentType)) {
      fail("/sw.js type", `content-type was "${contentType}"`);
    }

    const body = await readText(workerResponse);
    if (!body.includes('addEventListener("fetch"')) {
      fail("/sw.js body", "no fetch handler");
    }
    // Delivery-level pin for the update handshake: a worker served from an old
    // build would silently take over again. The message token alone is not
    // enough — it also appears in the file's own commentary, so a check for the
    // word would pass on a worker that never reads it.
    if (!body.includes('addEventListener("message"')) {
      fail("/sw.js body", "no message handler");
    }
    if (!body.includes('event.data.type === "SKIP_WAITING"')) {
      fail("/sw.js body", "the message handler does not read SKIP_WAITING");
    }
  }

  const loginResponse = await get("/login");
  if (loginResponse) {
    if (!loginResponse.ok) {
      fail("/login status", `HTTP ${loginResponse.status}`);
    }
    const html = await readText(loginResponse);
    for (const tag of CAPABILITY_TAGS) {
      if (!html.includes(tag)) {
        fail("/login markup", `missing "${tag}"`);
      }
    }
    if (!/rel="manifest"/.test(html)) {
      fail("/login markup", "no manifest link");
    }
  }

  const offlineResponse = await get("/offline");
  if (offlineResponse && !offlineResponse.ok) {
    fail("/offline status", `HTTP ${offlineResponse.status}`);
  }

  return failures;
}

// ─── CLI ────────────────────────────────────────────────────────────────────
// `npm run check:pwa` after a build. Boots `next start` itself unless
// PWA_CHECK_BASE points at a server that is already running.

const DEFAULT_PORT = "3101";

async function waitForServer(base, deadlineMs = 60_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < deadlineMs) {
    try {
      const response = await fetch(new URL("/manifest.webmanifest", base));
      if (response.status < 500) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function main() {
  const explicitBase = process.env.PWA_CHECK_BASE;
  const port = process.env.PWA_CHECK_PORT ?? DEFAULT_PORT;
  const base = explicitBase ?? `http://127.0.0.1:${port}`;

  let server = null;

  if (!explicitBase) {
    server = spawn("npx", ["next", "start", "-p", port], {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });

    if (!(await waitForServer(base))) {
      console.error(`check:pwa — the app never answered on ${base}`);
      server.kill("SIGTERM");
      process.exit(1);
    }
  }

  try {
    const failures = await checkPwaSurface({ fetchImpl: fetch, base });

    if (failures.length === 0) {
      console.log(`check:pwa — PWA surface intact on ${base}`);
      return;
    }

    for (const failure of failures) {
      console.error(`check:pwa — ${failure.check}: ${failure.detail}`);
    }
    process.exitCode = 1;
  } finally {
    if (server) server.kill("SIGTERM");
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  await main();
}
