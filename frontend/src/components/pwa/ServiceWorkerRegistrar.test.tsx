import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { PWA_SCOPE, SW_PATH } from "@/lib/pwa";

/** jsdom ships no service worker container, so the test supplies one. */
function stubServiceWorker() {
  const register = vi.fn(async () => ({ scope: PWA_SCOPE }));
  Object.defineProperty(navigator, "serviceWorker", {
    value: { register },
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
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

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

  it("survives a rejected registration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = vi.fn(async () => {
      throw new Error("scope denied");
    });
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });

    render(<ServiceWorkerRegistrar />);

    // An unhandled rejection here would be reported as an app error even though
    // the app keeps working without offline support.
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });
});
