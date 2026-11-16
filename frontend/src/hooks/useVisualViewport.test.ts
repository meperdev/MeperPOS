import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBelowSmViewport, useVisualViewport } from "./useVisualViewport";

const originalInnerHeight = window.innerHeight;

const restoreMatchMedia = () => {
  Reflect.deleteProperty(window, "matchMedia");
};

const stubSmBreakpoint = (matches: boolean) => {
  const matchMedia = vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, "matchMedia", {
    value: matchMedia,
    configurable: true,
    writable: true,
  });
  return matchMedia;
};

/** An on-screen keyboard shrinks the visual viewport without resizing the layout viewport. */
const stubVisualViewport = (height: number, offsetTop = 0) => {
  const listeners = new Set<() => void>();
  const viewport = {
    width: 390,
    height,
    offsetTop,
    offsetLeft: 0,
    scale: 1,
    pageTop: offsetTop,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, "visualViewport", {
    value: viewport,
    configurable: true,
    writable: true,
  });
  return {
    viewport,
    setHeight(nextHeight: number) {
      viewport.height = nextHeight;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
};

afterEach(() => {
  restoreMatchMedia();
  Reflect.deleteProperty(window, "visualViewport");
  Object.defineProperty(window, "innerHeight", {
    value: originalInnerHeight,
    configurable: true,
    writable: true,
  });
});

describe("useBelowSmViewport", () => {
  it("reports the sheet viewport when 640px does not match", () => {
    const matchMedia = stubSmBreakpoint(false);

    const { result } = renderHook(() => useBelowSmViewport());

    expect(result.current).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 640px)");
  });

  it("reports the desktop viewport from 640px up", () => {
    stubSmBreakpoint(true);

    const { result } = renderHook(() => useBelowSmViewport());

    expect(result.current).toBe(false);
  });

  it("falls back to the desktop viewport when matchMedia is unavailable", () => {
    const { result } = renderHook(() => useBelowSmViewport());

    expect(result.current).toBe(false);
  });
});

describe("useVisualViewport", () => {
  it("reports no hidden height without a visual viewport", () => {
    const { result } = renderHook(() => useVisualViewport());

    expect(result.current).toBe(0);
  });

  it("reports the height the on-screen keyboard covers", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 844,
      configurable: true,
      writable: true,
    });
    stubVisualViewport(544);

    const { result } = renderHook(() => useVisualViewport());

    expect(result.current).toBe(300);
  });

  it("subscribes to viewport changes and cleans up", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 844,
      configurable: true,
      writable: true,
    });
    const { setHeight, listenerCount } = stubVisualViewport(844);

    const { result, unmount } = renderHook(() => useVisualViewport());
    expect(result.current).toBe(0);
    expect(listenerCount()).toBeGreaterThan(0);

    act(() => setHeight(600));
    expect(result.current).toBe(244);

    unmount();
    expect(listenerCount()).toBe(0);  });

  it("counts the visual viewport offset when the page scrolled under the keyboard", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 844,
      configurable: true,
      writable: true,
    });
    stubVisualViewport(500, 44);

    const { result } = renderHook(() => useVisualViewport());

    expect(result.current).toBe(300);
  });
});
