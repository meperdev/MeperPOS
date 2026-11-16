import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canAnimateRouteTransition,
  navigateWithRouteTransition,
  startRouteTransition,
} from "./viewTransition";

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "startViewTransition",
);

/** Installs the API jsdom does not ship, and reports what it was called with. */
function stubViewTransition() {
  const contexts: unknown[] = [];
  const start = vi.fn(function (
    this: unknown,
    callback?: () => void | Promise<void>,
  ) {
    contexts.push(this);
    void callback?.();
  });
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    writable: true,
    value: start,
  });
  return Object.assign(start, { contexts });
}

function stubReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function plainClick(overrides: Record<string, unknown> = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStartViewTransition) {
    Object.defineProperty(
      Document.prototype,
      "startViewTransition",
      originalStartViewTransition,
    );
  } else {
    delete (document as unknown as Record<string, unknown>).startViewTransition;
  }
  delete (window as unknown as Record<string, unknown>).matchMedia;
});

describe("startRouteTransition", () => {
  it("hands the navigation to the browser when it can animate it", () => {
    const start = stubViewTransition();
    stubReducedMotion(false);
    const navigate = vi.fn();

    expect(canAnimateRouteTransition()).toBe(true);
    expect(startRouteTransition(navigate)).toBe(true);

    expect(start).toHaveBeenCalledTimes(1);
    // The navigation runs inside the transition, so the browser captures the
    // old page before it and the new one after it.
    expect(navigate).toHaveBeenCalledTimes(1);
    // `startViewTransition` is a method: called detached, the browser throws
    // "Illegal invocation" and the route stays where it was (seen in the real
    // browser, not in this test, the first time this shipped).
    expect(start.contexts[0]).toBe(document);
  });

  it("swallows the rejection a skipped transition leaves behind", () => {
    // Chromium rejects `finished` when it aborts a transition (a slow commit, a
    // background tab). Nothing awaits it, so it has to be caught here or every
    // such navigation logs an unhandled rejection.
    const finished = Promise.reject(new Error("Transition was aborted"));
    const swallow = vi.spyOn(finished, "catch");
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ ready: Promise.resolve(), finished })),
    });
    stubReducedMotion(false);

    expect(startRouteTransition(vi.fn())).toBe(true);

    expect(swallow).toHaveBeenCalledTimes(1);
  });

  it("navigates directly when the browser has no View Transitions API", () => {
    stubReducedMotion(false);
    const navigate = vi.fn();

    expect(canAnimateRouteTransition()).toBe(false);
    expect(startRouteTransition(navigate)).toBe(false);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("navigates directly when the user asked for reduced motion", () => {
    const start = stubViewTransition();
    stubReducedMotion(true);
    const navigate = vi.fn();

    expect(canAnimateRouteTransition()).toBe(false);
    expect(startRouteTransition(navigate)).toBe(false);

    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("navigateWithRouteTransition", () => {
  it("takes over a plain click so the route can cross-fade", () => {
    stubViewTransition();
    stubReducedMotion(false);
    const navigate = vi.fn();
    const event = plainClick();

    expect(navigateWithRouteTransition(event, navigate)).toBe(true);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("leaves every click the browser opens elsewhere to the browser", () => {
    stubViewTransition();
    stubReducedMotion(false);

    for (const overrides of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
      { defaultPrevented: true },
    ]) {
      const navigate = vi.fn();
      const event = plainClick(overrides);

      expect(navigateWithRouteTransition(event, navigate)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    }
  });

  it("leaves the click alone when motion is reduced, so the link works as usual", () => {
    stubViewTransition();
    stubReducedMotion(true);
    const navigate = vi.fn();
    const event = plainClick();

    expect(navigateWithRouteTransition(event, navigate)).toBe(false);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("route transition stylesheet contract", () => {
  const css = readFileSync(
    path.resolve(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  it("cross-fades the root snapshot through opacity below 200ms", () => {
    expect(css).toMatch(/::view-transition-old\(root\)\s*\{[^}]*route-fade-out/);
    expect(css).toMatch(/::view-transition-new\(root\)\s*\{[^}]*route-fade-in/);

    const duration = css.match(/animation:\s*route-fade-out\s+(\d+)ms/)?.[1];
    expect(duration).toBeDefined();
    expect(Number(duration)).toBeLessThanOrEqual(200);
    expect(Number(duration)).toBeGreaterThan(0);

    // Motion is a fade, never a slide: the content does not travel.
    for (const name of ["route-fade-out", "route-fade-in"]) {
      const body = css.match(
        new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
      )?.[1];
      expect(body).toBeDefined();
      expect(body).toContain("opacity");
      expect(body).not.toContain("transform");
    }
  });

  it("switches every view-transition animation off under reduced motion", () => {
    const reduced = css.slice(css.indexOf("(prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/::view-transition-new\(\*\)/);
    expect(reduced).toMatch(/animation:\s*none\s*!important/);
  });
});
