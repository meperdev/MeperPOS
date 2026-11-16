import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldAutoFocusTextInput } from "./input-focus";

/**
 * jsdom ships no `matchMedia`. Each test installs the answers it needs so the
 * rule is exercised through the real call the app makes.
 */
function stubMediaQuery(answers: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: answers[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const restoreMatchMedia = () => Reflect.deleteProperty(window, "matchMedia");

afterEach(restoreMatchMedia);

describe("shouldAutoFocusTextInput", () => {
  it("keeps today's autofocus where media queries do not exist", () => {
    // SSR, jsdom and old embedded webviews: no evidence of a finger, so the
    // desktop behaviour is the safe default.
    restoreMatchMedia();

    expect(shouldAutoFocusTextInput()).toBe(true);
  });

  it("never focuses a text field on its own when the primary pointer is a finger", () => {
    stubMediaQuery({ "(pointer: coarse)": true });

    expect(shouldAutoFocusTextInput()).toBe(false);
  });

  it("keeps the autofocus for a mouse", () => {
    stubMediaQuery({ "(pointer: coarse)": false });

    expect(shouldAutoFocusTextInput()).toBe(true);
  });

  it("asks the coarse-pointer query, not a viewport width", () => {
    stubMediaQuery({ "(pointer: coarse)": true });

    shouldAutoFocusTextInput();

    expect(window.matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
  });
});
