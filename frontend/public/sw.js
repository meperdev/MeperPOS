/**
 * MeperPOS service worker — offline app shell only.
 *
 * What this worker is for: so an installed app opens to its own frame instead
 * of the browser's network-error page, and so a drop in connectivity does not
 * look like a crash.
 *
 * What this worker deliberately is NOT: a product-data cache. It never stores
 * or serves an API response. It only ever stores same-origin GETs that matched
 * a navigation or a static asset, it refuses any follow of a redirect, and it
 * skips a response that was not successful.
 *
 * What it does store for a navigation is the rendered HTML shell. Every route
 * in this app is a client component, so those shells carry no server-rendered
 * data and Cache Storage never sees a product, customer or money value. That is
 * an assumption about the app, not a property of this file: if a route is ever
 * rendered on the server with data, this guarantee stops holding and this
 * comment has to change with it.
 *
 * Safety rules, in order of importance:
 *   1. Same-origin GET only. The API is deployed on another origin and is
 *      skipped twice over — by origin and by the /api/ prefix.
 *   2. Navigations are network-first, so an online device always gets whatever
 *      is deployed. A shell this worker cached earlier is served only while the
 *      network is unreachable, which is exactly when a stale shell beats no app.
 *   3. Storage never decides a request's fate. Opening, reading and writing are
 *      all best effort: when storage is full, refused or unavailable, the
 *      request falls through to the network instead of failing.
 *   4. Cache names carry a version. Bumping CACHE_VERSION is the supported way
 *      to invalidate everything. The matching constants live in
 *      `src/lib/pwa.ts`, and `src/lib/sw-behavior.test.ts` drives the handlers
 *      below with stub caches while `src/lib/pwa.test.ts` fails if the two
 *      copies of these literals drift apart.
 *
 * Emergency rollback, if this file ever misbehaves in production: replace its
 * contents with the self-unregistering worker below, deploy, and every
 * installed client drops the worker and its caches on the next load.
 *
 *   self.addEventListener("install", () => self.skipWaiting());
 *   self.addEventListener("activate", (event) =>
 *     event.waitUntil(
 *       caches
 *         .keys()
 *         .then((names) => Promise.all(names.map((name) => caches.delete(name))))
 *         .then(() => self.registration.unregister()),
 *     ),
 *   );
 */

const CACHE_VERSION = "v1";

const STATIC_CACHE = `meperpos-static-${CACHE_VERSION}`;
const PAGES_CACHE = `meperpos-pages-${CACHE_VERSION}`;

const OFFLINE_URL = "/offline";
const MANIFEST_URL = "/manifest.webmanifest";

const PRECACHE_URLS = [OFFLINE_URL, MANIFEST_URL];

/** Content-hashed by the Next build, so a cached copy is never stale. */
const IMMUTABLE_PREFIXES = ["/_next/static/"];

/** Stable names that change only on a deploy, so they are revalidated. */
const ASSET_PREFIXES = ["/icons/", "/brand/"];
const ASSET_URLS = [MANIFEST_URL];

const CACHE_ALLOWLIST = [STATIC_CACHE, PAGES_CACHE];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await openCache(STATIC_CACHE);

      // Added one at a time on purpose: `addAll` rejects as a whole, so a single
      // unreachable URL would fail the entire worker and cost offline support
      // outright rather than just that one entry. A storage that cannot even be
      // opened skips precaching entirely and still activates, because a worker
      // that serves only from the network is worth more than no worker at all.
      if (cache) {
        await Promise.all(
          PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined)),
        );
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Versioned names are the only invalidation mechanism, so any cache that
      // is not part of the current pair is a superseded one. Failing to clean up
      // is not worth failing activation over: a superseded cache is inert, while
      // a worker that never activates costs offline support entirely.
      try {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((name) => !CACHE_ALLOWLIST.includes(name))
            .map((name) => caches.delete(name).catch(() => undefined)),
        );
      } catch {
        // Superseded caches stay behind; the current pair is still usable.
      }

      await self.clients.claim();
    })(),
  );
});

function isImmutableAsset(pathname) {
  return IMMUTABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isStableAsset(pathname) {
  return (
    ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    ASSET_URLS.includes(pathname)
  );
}

/**
 * Opens a cache, or reports that storage is unavailable.
 *
 * Every strategy treats "no cache" as "no offline copy" and falls through to
 * the network. Storage is an optimisation here: it must never be able to fail a
 * request that the network would have answered.
 */
async function openCache(name) {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

/** Reads from a cache that may not exist, and may itself refuse. */
async function readCached(cache, request) {
  if (!cache) return undefined;
  try {
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

/** Searches every cache for the precached offline shell. */
async function findOfflinePage() {
  try {
    return await caches.match(OFFLINE_URL);
  } catch {
    return undefined;
  }
}

/**
 * Stores a response for later, and never reports failure.
 *
 * Two reasons to skip: a non-2xx response is not worth keeping, and a followed
 * redirect cached under the requested URL would serve the wrong page offline.
 * The cost of refusing redirects is that a canonicalising redirect warms
 * neither URL, so that one navigation has no offline copy.
 *
 * The write is awaited rather than detached, so it still completes inside the
 * lifetime of the intercepted request when the worker is stopped straight
 * afterwards — but the rejection is swallowed, because a full quota or a
 * private tab must never turn a healthy response into a failed request.
 */
async function remember(cache, request, response) {
  if (!cache || !response || !response.ok || response.redirected) return;
  await cache.put(request, response.clone()).catch(() => undefined);
}

async function fromCacheFirst(request) {
  const cache = await openCache(STATIC_CACHE);
  const cached = await readCached(cache, request);
  if (cached) return cached;

  const response = await fetch(request);
  await remember(cache, request, response);
  return response;
}

async function fromCacheWhileRevalidating(request) {
  const cache = await openCache(STATIC_CACHE);
  const cached = await readCached(cache, request);

  const network = fetch(request).then(async (response) => {
    await remember(cache, request, response);
    return response;
  });

  if (cached) {
    // The cached copy wins; a failed background refresh must not surface as an
    // unhandled rejection just because nobody is awaiting it.
    network.catch(() => undefined);
    return cached;
  }

  return network;
}

async function forNavigation(request) {
  const cache = await openCache(PAGES_CACHE);

  try {
    // Network first, so a deploy is picked up as soon as the device is online.
    const response = await fetch(request);
    await remember(cache, request, response);
    return response;
  } catch {
    const cached = await readCached(cache, request);
    if (cached) return cached;

    const offline = await findOfflinePage();
    if (offline) return offline;

    // Nothing was ever cached: let the browser show its own error page.
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!request || request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(forNavigation(request));
    return;
  }

  if (isImmutableAsset(url.pathname)) {
    event.respondWith(fromCacheFirst(request));
    return;
  }

  if (isStableAsset(url.pathname)) {
    event.respondWith(fromCacheWhileRevalidating(request));
  }
});
