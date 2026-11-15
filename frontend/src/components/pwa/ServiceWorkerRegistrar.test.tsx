import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { PWA_SCOPE, SW_PATH } from "@/lib/pwa";
import { getSwUpdateSnapshot, resetSwUpdateStore } from "@/lib/sw-update";

/**
 * jsdom ships no service worker container, so the test supplies one. `waiting`
 * and `controller` are what the update path actually reads, so the stub has to
 * model them rather than only the registration promise.
 */
function stubServiceWorker(
  options: {
    waiting?: unknown;
    controlled?: boolean;
    registration?: Record<string, unknown>;
  } = {}
) {
  const register = vi.fn(async () => ({
    scope: PWA_SCOPE,
    waiting: options.waiting ?? null,
    addEventListener: vi.fn(),
    ...options.registration,
  }));
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      register,
      controller: options.controlled ? {} : null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    configurable: true,
  });
  return register;
}

function forceLoadingState() {
  return vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetSwUpdateStore();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

/**
 * A registration that can actually report an update. The real path is
 * `updatefound` on the registration followed by `statechange` on the installing
 * worker, so the stub has to be able to fire both, in that order.
 */
function stubUpdatingServiceWorker(options: { controlled: boolean }) {
  const registrationListeners = new Map<string, Array<() => void>>();
  const workerListeners = new Map<string, Array<() => void>>();
  const installing = {
    state: "installing",
    postMessage: vi.fn(),
    addEventListener: (type: string, handler: () => void) => {
      workerListeners.set(type, [...(workerListeners.get(type) ?? []), handler]);
    },
  };
  const registration = {
    scope: PWA_SCOPE,
    waiting: null,
    installing,
    addEventListener: (type: string, handler: () => void) => {
      registrationListeners.set(type, [
        ...(registrationListeners.get(type) ?? []),
        handler,
      ]);
    },
  };
  const register = vi.fn(async () => registration);
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      register,
      controller: options.controlled ? {} : null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    configurable: true,
  });

  return {
    register,
    fire: (type: string) => {
      for (const handler of registrationListeners.get(type) ?? []) handler();
    },
    install: () => {
      installing.state = "installed";
      for (const handler of workerListeners.get("statechange") ?? []) handler();
    },
  };
}

describe("ServiceWorkerRegistrar", () => {
  it("registers the worker at the shipped path with an explicit scope", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = stubServiceWorker();

    render(<ServiceWorkerRegistrar />);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith(SW_PATH, {
      scope: PWA_SCOPE,
      updateViaCache: "none",
    });
  });

  it("stays out of development builds", () => {
    vi.stubEnv("NODE_ENV", "development");
    const register = stubServiceWorker();

    render(<ServiceWorkerRegistrar />);

    expect(register).not.toHaveBeenCalled();
  });

  it("does nothing when the browser has no service worker support", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;

    expect(() => render(<ServiceWorkerRegistrar />)).not.toThrow();
  });

  it("defers registration until the page has loaded", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = stubServiceWorker();
    forceLoadingState();

    render(<ServiceWorkerRegistrar />);
    expect(register).not.toHaveBeenCalled();

    fireEvent(window, new Event("load"));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });

  it("stops waiting for load once unmounted", () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = stubServiceWorker();
    forceLoadingState();

    const { unmount } = render(<ServiceWorkerRegistrar />);
    unmount();

    fireEvent(window, new Event("load"));

    expect(register).not.toHaveBeenCalled();
  });

  it("announces a waiting worker that is sitting behind a live page", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const waiting = { postMessage: vi.fn(), state: "installed" };
    stubServiceWorker({ waiting, controlled: true });

    render(<ServiceWorkerRegistrar />);

    await waitFor(() => expect(getSwUpdateSnapshot()).toBe(true));
  });

  it("does not offer an update on a first install with no page controlled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // A worker that activates with nobody controlled is the first install, not
    // a replacement: there is nothing to swap and no reason to show an offer.
    stubServiceWorker({ waiting: { postMessage: vi.fn() }, controlled: false });

    render(<ServiceWorkerRegistrar />);

    await waitFor(() => expect(getSwUpdateSnapshot()).toBe(false));
  });

  it("announces a worker that finishes installing while the page is open", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const harness = stubUpdatingServiceWorker({ controlled: true });

    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(harness.register).toHaveBeenCalledTimes(1));

    act(() => {
      harness.fire("updatefound");
      harness.install();
    });

    expect(getSwUpdateSnapshot()).toBe(true);
  });

  it("ignores an install that finishes with no page controlled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const harness = stubUpdatingServiceWorker({ controlled: false });

    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(harness.register).toHaveBeenCalledTimes(1));

    act(() => {
      harness.fire("updatefound");
      harness.install();
    });

    // First install: `clients.claim()` fires `controllerchange` too, and there
    // is nothing to replace, so an offer here would be a button that reloads
    // for no reason.
    expect(getSwUpdateSnapshot()).toBe(false);
  });

  it("survives a rejected registration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = vi.fn(async () => {
      throw new Error("scope denied");
    });
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register,
        controller: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });

    render(<ServiceWorkerRegistrar />);

    // An unhandled rejection here would be reported as an app error even though
    // the app keeps working without offline support.
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });
});
