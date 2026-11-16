import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffectiveViewMode } from "@/hooks/useEffectiveViewMode";

type Listener = (event: MediaQueryListEvent) => void;

/**
 * jsdom ships no `matchMedia`; this stub answers one query and lets a test move
 * the viewport across the breakpoint the way a real rotation would.
 */
function stubViewport(initialMatches: boolean, query = "(min-width: 640px)") {
  const listeners = new Set<Listener>();
  const list = {
    matches: initialMatches,
    media: query,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => list),
  });

  return {
    cross(next: boolean) {
      list.matches = next;
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
  };
}

function removeMatchMedia() {
  Reflect.deleteProperty(window, "matchMedia");
}

afterEach(() => {
  window.localStorage.clear();
  removeMatchMedia();
  cleanup();
});

describe("useEffectiveViewMode", () => {
  it("renders cards on a phone even when the stored preference is the table", () => {
    stubViewport(false);
    window.localStorage.setItem("meperpos:view-mode:inventory", "table");

    const { result } = renderHook(() => useEffectiveViewMode("inventory"));

    expect(result.current[0]).toBe("grid");
    // The preference is not overwritten: the table comes back on a wide screen.
    expect(window.localStorage.getItem("meperpos:view-mode:inventory")).toBe("table");
  });

  it("respects the stored table at and above sm", () => {
    stubViewport(true);
    window.localStorage.setItem("meperpos:view-mode:inventory", "table");

    const { result } = renderHook(() => useEffectiveViewMode("inventory"));

    expect(result.current[0]).toBe("table");
  });

  it("keeps the stored preference when the viewport cannot be measured", () => {
    removeMatchMedia();
    window.localStorage.setItem("meperpos:view-mode:inventory", "table");

    const { result } = renderHook(() => useEffectiveViewMode("inventory"));

    expect(result.current[0]).toBe("table");
  });

  it("follows the viewport across sm in both directions", () => {
    const viewport = stubViewport(true);
    window.localStorage.setItem("meperpos:view-mode:sales", "table");

    const { result } = renderHook(() => useEffectiveViewMode("sales"));
    expect(result.current[0]).toBe("table");

    act(() => viewport.cross(false));
    expect(result.current[0]).toBe("grid");

    act(() => viewport.cross(true));
    expect(result.current[0]).toBe("table");
  });

  it("still writes the user's choice through the setter", () => {
    stubViewport(false);
    const { result } = renderHook(() => useEffectiveViewMode("customers"));

    act(() => result.current[1]("table"));

    expect(window.localStorage.getItem("meperpos:view-mode:customers")).toBe("table");
    // On a phone the rendered mode stays cards, but the choice is remembered.
    expect(result.current[0]).toBe("grid");
  });
});
