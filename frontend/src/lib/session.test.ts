import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSessionState,
  getAccessToken,
  setAccessToken,
  SELECTED_ORGANIZATION_KEY,
  USER_DISPLAY_CACHE_KEY,
} from "@/lib/session";
import { SW_PAGES_CACHE, SW_STATIC_CACHE } from "@/lib/pwa";

function stubCacheStorage(deletion: () => Promise<boolean>) {
  const deleted: string[] = [];
  const caches = {
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return deletion();
    }),
  };
  Object.defineProperty(globalThis, "caches", {
    value: caches,
    writable: true,
    configurable: true,
  });
  return deleted;
}

afterEach(() => {
  // jsdom ships no CacheStorage, so each test that adds one must remove it.
  delete (globalThis as { caches?: unknown }).caches;
  vi.restoreAllMocks();
});

describe("clearSessionState", () => {
  it("drops the cached page shells for the session that is ending", async () => {
    const deleted = stubCacheStorage(async () => true);

    clearSessionState();

    await vi.waitFor(() => expect(deleted).toContain(SW_PAGES_CACHE));
    // The static cache holds only public, content-hashed assets, so wiping it
    // would cost a full re-download and protect nothing.
    expect(deleted).not.toContain(SW_STATIC_CACHE);
  });

  it("still clears the in-memory token and the stored session keys", () => {
    stubCacheStorage(async () => true);
    setAccessToken("access-token");
    localStorage.setItem(USER_DISPLAY_CACHE_KEY, JSON.stringify({ id: "u1" }));
    localStorage.setItem(SELECTED_ORGANIZATION_KEY, "org-1");

    clearSessionState();

    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem(USER_DISPLAY_CACHE_KEY)).toBeNull();
    expect(localStorage.getItem(SELECTED_ORGANIZATION_KEY)).toBeNull();
  });

  it("survives a browser with no Cache Storage", () => {
    setAccessToken("access-token");

    expect(() => clearSessionState()).not.toThrow();
    expect(getAccessToken()).toBeNull();
  });

  it("survives a rejected cache deletion", async () => {
    setAccessToken("access-token");
    stubCacheStorage(async () => {
      throw new Error("storage unavailable");
    });

    // Teardown must not be able to fail: a logout that throws leaves the
    // operator signed in with no explanation.
    expect(() => clearSessionState()).not.toThrow();
    await vi.waitFor(() => expect(getAccessToken()).toBeNull());
  });
});
