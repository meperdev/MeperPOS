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
 * can be tested with a fake transport, and the CLI is exported too so its exit
 * code — the only thing CI reads — is not the untested half.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
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

/**
 * Strings the built stylesheet must carry. Tailwind compiles arbitrary values
 * from source class names, and an arbitrary value it decides to drop leaves a
 * green class assertion and an unprotected device behind.
 */
const REQUIRED_CSS_FRAGMENTS = [
  { label: "the safe-area top token", fragment: "--safe-top:env(" },
  { label: "the safe-area bottom token", fragment: "--safe-bottom:env(" },
  { label: "the mobile header token", fragment: "--mobile-header:" },
  { label: "a composed header offset", fragment: "var(--mobile-header)" },
];

async function readText(response) {
  return response.text();
}

/** Whether the page declares a meta tag with exactly this name attribute. */
function hasMetaName(html, name) {
  return new RegExp(`name="${name}"`).test(html);
}

/** Absolute URLs of the stylesheets a page links. */
function styleSheetUrls(html, base) {
  const urls = [];
  const pattern = /<link[^>]+href="([^"]+\.css)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      urls.push(new URL(match[1], base).href);
    } catch {
      // A malformed href is not worth failing over on its own.
    }
  }
  return urls;
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
  let loginHtml = "";
  if (loginResponse) {
    if (!loginResponse.ok) {
      fail("/login status", `HTTP ${loginResponse.status}`);
    }
    loginHtml = await readText(loginResponse);
    for (const tag of CAPABILITY_TAGS) {
      // Matched as an attribute, never as a substring: the Apple tag contains
      // the generic name, so `includes("mobile-web-app-capable")` reports
      // success on a page that only carries the Apple one.
      if (!hasMetaName(loginHtml, tag)) {
        fail("/login markup", `missing "${tag}"`);
      }
    }
    if (!/rel="manifest"/.test(loginHtml)) {
      fail("/login markup", "no manifest link");
    }
  }

  const offlineResponse = await get("/offline");
  if (offlineResponse && !offlineResponse.ok) {
    fail("/offline status", `HTTP ${offlineResponse.status}`);
  }

  // The stylesheet is where the safe-area work actually lives: the class names
  // in the markup prove nothing on their own.
  const sheetUrls = styleSheetUrls(loginHtml, base);
  if (sheetUrls.length === 0) {
    fail("/login stylesheet", "no stylesheet link found");
  }

  let css = "";
  for (const url of sheetUrls.slice(0, 5)) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        fail("stylesheet status", `HTTP ${response.status} for ${url}`);
        continue;
      }
      css += await readText(response);
    } catch (error) {
      fail("stylesheet reachable", `${url}: ${String(error)}`);
    }
  }

  for (const { label, fragment } of REQUIRED_CSS_FRAGMENTS) {
    if (!css.includes(fragment)) {
      fail("built stylesheet", `missing ${label} ("${fragment}")`);
    }
  }

  return failures;
}

// ─── CLI ────────────────────────────────────────────────────────────────────
// `npm run check:pwa` after a build. Boots `next start` itself unless
// PWA_CHECK_BASE points at a server that is already running.

const STARTUP_TIMEOUT_MS = 60_000;

export async function waitForServer(base, deadlineMs = STARTUP_TIMEOUT_MS) {
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

/**
 * Asks the OS for a port nobody is using. A fixed port would let any lingering
 * `next start` from an earlier run answer for this one, which makes a green
 * result meaningless.
 */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(String(port)));
    });
  });
}

/** Waits for the child to exit, so a killed server cannot outlive the check. */
function waitForExit(child, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * The whole command, returning the exit code CI actually reads. Everything with
 * a side effect is injectable so the failure plumbing is testable.
 */
export async function runCli({
  fetchImpl = fetch,
  spawnImpl = spawn,
  waitForServerImpl = waitForServer,
  findFreePortImpl = findFreePort,
  log = console,
  env = process.env,
} = {}) {
  const explicitBase = env.PWA_CHECK_BASE;
  const port =
    env.PWA_CHECK_PORT ?? (explicitBase ? null : await findFreePortImpl());
  const base = explicitBase ?? `http://127.0.0.1:${port}`;

  let server = null;

  if (!explicitBase) {
    try {
      server = spawnImpl("npx", ["next", "start", "-p", port], {
        stdio: ["ignore", "ignore", "inherit"],
        env: { ...env, NEXT_TELEMETRY_DISABLED: "1" },
      });
    } catch (error) {
      log.error(`check:pwa — could not start the app: ${String(error)}`);
      return 1;
    }

    let spawnError = null;
    server.once("error", (error) => {
      spawnError = error;
    });

    if (!(await waitForServerImpl(base))) {
      await waitForExit(server);
      log.error(
        `check:pwa — the app never answered on ${base}${
          spawnError ? ` (${String(spawnError)})` : ""
        }`
      );
      return 1;
    }
  }

  try {
    const failures = await checkPwaSurface({ fetchImpl, base });

    if (failures.length === 0) {
      log.log(`check:pwa — PWA surface intact on ${base}`);
      return 0;
    }

    for (const failure of failures) {
      log.error(`check:pwa — ${failure.check}: ${failure.detail}`);
    }
    return 1;
  } finally {
    if (server) {
      server.kill("SIGTERM");
      await waitForExit(server);
    }
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exitCode = await runCli();
}
