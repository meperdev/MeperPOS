import { afterEach, describe, expect, it, vi } from "vitest";

import { HAPTIC_PATTERNS, haptic } from "./haptics";

/**
 * `navigator.vibrate` does not exist in jsdom and `matchMedia` is not
 * implemented either, so each case installs exactly the environment it is
 * about and removes it again.
 */
const originalVibrate = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "vibrate",
);

function stubVibrate() {
  const vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    writable: true,
    value: vibrate,
  });
  return vibrate;
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

afterEach(() => {
  vi.restoreAllMocks();
  if (originalVibrate) {
    Object.defineProperty(navigator, "vibrate", originalVibrate);
  } else {
    delete (navigator as unknown as Record<string, unknown>).vibrate;
  }
  delete (window as unknown as Record<string, unknown>).matchMedia;
});

describe("haptic", () => {
  it("buzzes the pattern each kind of feedback owns", () => {
    const vibrate = stubVibrate();

    haptic("tap");
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.tap);

    haptic("success");
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.success);

    haptic("warning");
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.warning);
  });

  it("keeps every pattern short: one tap, and two pulses at most for the rest", () => {
    // Restraint (D6): a till that rattles is worse than one that says nothing.
    expect(HAPTIC_PATTERNS.tap).toHaveLength(1);
    expect(HAPTIC_PATTERNS.success.length).toBeLessThanOrEqual(3);
    expect(HAPTIC_PATTERNS.warning.length).toBeLessThanOrEqual(3);
    for (const pattern of Object.values(HAPTIC_PATTERNS)) {
      for (const pulse of pattern) {
        expect(pulse).toBeGreaterThan(0);
        expect(pulse).toBeLessThanOrEqual(60);
      }
    }
  });

  it("does nothing on a device that cannot vibrate", () => {
    stubReducedMotion(false);

    expect(() => haptic("success")).not.toThrow();
  });

  it("stays silent when the user asked for reduced motion", () => {
    const vibrate = stubVibrate();
    stubReducedMotion(true);

    haptic("warning");

    expect(vibrate).not.toHaveBeenCalled();
  });

  it("survives a browser that refuses to vibrate", () => {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("not allowed");
      },
    });
    stubReducedMotion(false);

    expect(() => haptic("tap")).not.toThrow();
  });
});
