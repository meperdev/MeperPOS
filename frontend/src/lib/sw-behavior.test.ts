import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  PWA_OFFLINE_URL,
  SW_PAGES_CACHE,
  SW_PATH,
  SW_STATIC_CACHE,
} from "@/lib/pwa";

const ORIGIN = "https://app.meperpos.test";

const SW_SOURCE = readFileSync(
  path.resolve(process.cwd(), "public/sw.js"),
  "utf8",
);

interface FakeResponse {
  ok: boolean;
  status: number;
  body: string;
  url: string;
  clone(): FakeResponse;
}

function fakeResponse(url: string, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: url,
    url,
    clone() {
      return fakeResponse(url, status);
    },
  };
}

function keyOf(request: unknown): string {
  return typeof request === "string" ? request : String((request as { url: string }).url);
}

type Handler = (event: unknown) => void;

interface CacheStore {
  entries: Map<string, FakeResponse>;
  add: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  match: ReturnType<typeof vi.fn>;
}

/**
 * Loads the real `public/sw.js` into a stubbed service-worker global scope.
 * The worker is only shipped as a plain script, so evaluating it is the only
 * way to exercise its handlers without a browser.
 */
function createScope(options: { failAddFor?: string[] } = {}) {
  const listeners = new Map<string, Handler[]>();
  const stores = new Map<string, CacheStore>();
  const deleted: string[] = [];
  const failAddFor = new Set(options.failAddFor ?? []);

  function storeFor(name: string): CacheStore {
    const existing = stores.get(name);
    if (existing) return existing;

    const entries = new Map<string, FakeResponse>();
    const store: CacheStore = {
      entries,
      add: vi.fn(async (request: unknown) => {
        const key = keyOf(request);
        if (failAddFor.has(key)) throw new Error(`unreachable: ${key}`);
        entries.set(key, fakeResponse(key));
      }),
      put: vi.fn(async (request: unknown, value: FakeResponse) => {
        entries.set(keyOf(request), value);
      }),
      match: vi.fn(async (request: unknown) => entries.get(keyOf(request))),
    };
    stores.set(name, store);
    return store;
  }

  const caches = {
    open: vi.fn(async (name: string) => storeFor(name)),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return stores.delete(name);
    }),
    match: vi.fn(async (request: unknown) => {
      for (const store of stores.values()) {
        const hit = store.entries.get(keyOf(request));
        if (hit) return hit;
      }
      return undefined;
    }),
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };

  const fetchMock = vi.fn(async (request: { url: string }) =>
    fakeResponse(request.url),
  );

  const Response = { error: () => fakeResponse("", 0) };

  new Function(
    "self",
    "caches",
    "fetch",
    "Response",
    "URL",
    SW_SOURCE,
  )(self, caches, fetchMock, Response, URL);

  const dispatch = (type: string, event: unknown) => {
    for (const handler of listeners.get(type) ?? []) handler(event);
  };

  const lifecycle = () => {
    const pending: Promise<unknown>[] = [];
    return {
      event: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
      settled: () => Promise.all(pending),
    };
  };

  const pageFetch = (request: Record<string, unknown>) => {
    let responded: Promise<FakeResponse> | undefined;
    return {
      event: {
        request: { method: "GET", mode: "no-cors", ...request },
        respondWith: (promise: Promise<FakeResponse>) => {
          responded = promise;
        },
      },
      response: () => responded,
    };
  };

  return {
    caches,
    deleted,
    dispatch,
    fetchMock,
    lifecycle,
    pageFetch,
    self,
    stores,
    storeFor,
  };
}

const navigation = (url = `${ORIGIN}/pos`) =>
  ({
    method: "GET",
    mode: "navigate",
    url,
  }) as Record<string, unknown>;

const asset = (url: string) =>
  ({ method: "GET", mode: "cors", url }) as Record<string, unknown>;

describe("service worker install", () => {
  it("precaches the offline shell and activates immediately", async () => {
    const scope = createScope();
    const lifecycle = scope.lifecycle();

    scope.dispatch("install", lifecycle.event);
    await lifecycle.settled();

    expect(scope.self.skipWaiting).toHaveBeenCalledTimes(1);
    expect(scope.storeFor(SW_STATIC_CACHE).entries.has(PWA_OFFLINE_URL)).toBe(
      true,
    );
  });

  it("still installs when a precached URL is unreachable", async () => {
    const scope = createScope({ failAddFor: [PWA_OFFLINE_URL] });
    const lifecycle = scope.lifecycle();

    scope.dispatch("install", lifecycle.event);

    // A rejected install would leave the worker stuck in "installing" forever
    // and silently delete the app's offline capability.
    await expect(lifecycle.settled()).resolves.toBeDefined();
    expect(scope.self.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe("service worker activate", () => {
  it("drops superseded caches and keeps the current pair", async () => {
    const scope = createScope();
    scope.storeFor("meperpos-static-v0");
    scope.storeFor("meperpos-pages-v0");
    scope.storeFor(SW_STATIC_CACHE);

    const lifecycle = scope.lifecycle();
    scope.dispatch("activate", lifecycle.event);
    await lifecycle.settled();

    expect(scope.deleted).toContain("meperpos-static-v0");
    expect(scope.deleted).toContain("meperpos-pages-v0");
    expect(scope.deleted).not.toContain(SW_STATIC_CACHE);
    expect(scope.deleted).not.toContain(SW_PAGES_CACHE);
    expect(scope.self.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe("service worker fetch routing", () => {
  it("ignores every request it must not touch", () => {
    const scope = createScope();

    const cases: Record<string, unknown>[] = [
      { method: "POST", mode: "cors", url: `${ORIGIN}/api/sales` },
      { method: "DELETE", mode: "cors", url: `${ORIGIN}/api/products/1` },
      // The API is deployed on another origin.
      { method: "GET", mode: "cors", url: "https://api.meperpos.test/api/sales" },
      // Same-origin API traffic, if the proxy decision ever lands.
      { method: "GET", mode: "cors", url: `${ORIGIN}/api/sales` },
      // React Server Component payloads for client-side navigation.
      { method: "GET", mode: "cors", url: `${ORIGIN}/dashboard?_rsc=abc` },
      { method: "GET", mode: "cors", url: `${ORIGIN}/pos` },
    ];

    for (const request of cases) {
      const probe = scope.pageFetch(request);
      scope.dispatch("fetch", probe.event);
      expect(probe.response()).toBeUndefined();
    }

    expect(scope.fetchMock).not.toHaveBeenCalled();
  });

  it("handles immutable chunks, stable assets and navigations", () => {
    const scope = createScope();

    const cases = [
      asset(`${ORIGIN}/_next/static/chunks/main-app-abc.js`),
      asset(`${ORIGIN}/icons/icon-192.png`),
      asset(`${ORIGIN}/brand/meperpos-mark-160.png`),
      navigation(),
    ];

    for (const request of cases) {
      const probe = scope.pageFetch(request);
      scope.dispatch("fetch", probe.event);
      expect(probe.response()).toBeDefined();
    }
  });

  it("never stores an API response", async () => {
    const scope = createScope();
    const probe = scope.pageFetch(navigation(`${ORIGIN}/pos`));
    scope.dispatch("fetch", probe.event);
    await probe.response();

    const cachedKeys = [
      ...scope.storeFor(SW_PAGES_CACHE).entries.keys(),
      ...scope.storeFor(SW_STATIC_CACHE).entries.keys(),
    ];

    expect(cachedKeys.some((key) => key.includes("/api/"))).toBe(false);
  });
});

describe("service worker caching strategies", () => {
  it("serves a hashed chunk from cache without a second network call", async () => {
    const scope = createScope();
    const url = `${ORIGIN}/_next/static/chunks/main-app-abc.js`;

    const first = scope.pageFetch(asset(url));
    scope.dispatch("fetch", first.event);
    await first.response();

    const second = scope.pageFetch(asset(url));
    scope.dispatch("fetch", second.event);
    const cached = await second.response();

    expect(cached?.body).toBe(url);
    expect(scope.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves a stable asset from cache and revalidates in the background", async () => {
    const scope = createScope();
    const url = `${ORIGIN}/icons/icon-192.png`;

    const first = scope.pageFetch(asset(url));
    scope.dispatch("fetch", first.event);
    await first.response();

    const second = scope.pageFetch(asset(url));
    scope.dispatch("fetch", second.event);
    const cached = await second.response();

    expect(cached?.body).toBe(url);
    expect(scope.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the network page and remembers it while online", async () => {
    const scope = createScope();
    const probe = scope.pageFetch(navigation());
    scope.dispatch("fetch", probe.event);
    const response = await probe.response();

    expect(response?.status).toBe(200);
    expect(scope.storeFor(SW_PAGES_CACHE).entries.has(`${ORIGIN}/pos`)).toBe(
      true,
    );
  });

  it("falls back to the remembered page when the network is gone", async () => {
    const scope = createScope();

    const online = scope.pageFetch(navigation());
    scope.dispatch("fetch", online.event);
    await online.response();

    scope.fetchMock.mockRejectedValue(new Error("offline"));

    const offline = scope.pageFetch(navigation());
    scope.dispatch("fetch", offline.event);
    const response = await offline.response();

    expect(response?.body).toBe(`${ORIGIN}/pos`);
  });

  it("falls back to the offline shell when the page was never visited", async () => {
    const scope = createScope();

    const install = scope.lifecycle();
    scope.dispatch("install", install.event);
    await install.settled();

    scope.fetchMock.mockRejectedValue(new Error("offline"));

    const probe = scope.pageFetch(navigation(`${ORIGIN}/reports`));
    scope.dispatch("fetch", probe.event);
    const response = await probe.response();

    expect(response?.body).toBe(PWA_OFFLINE_URL);
  });

  it("reports a network error when nothing at all is cached", async () => {
    const scope = createScope();
    scope.fetchMock.mockRejectedValue(new Error("offline"));

    const probe = scope.pageFetch(navigation());
    scope.dispatch("fetch", probe.event);
    const response = await probe.response();

    expect(response?.status).toBe(0);
  });
});

describe("service worker source wiring", () => {
  it("is served from the path the registrar registers", () => {
    expect(SW_PATH).toBe("/sw.js");
    expect(
      readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf8").length,
    ).toBeGreaterThan(0);
  });
});
