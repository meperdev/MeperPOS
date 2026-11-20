import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFERRED_LOADING_DELAY_MS,
  DEFERRED_LOADING_MIN_VISIBLE_MS,
  useDeferredLoading,
} from "./useDeferredLoading";

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useDeferredLoading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("paints nothing when the load settles inside the delay, so a fast answer never flashes", () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDeferredLoading(isLoading),
      { initialProps: { isLoading: true } },
    );

    advance(DEFERRED_LOADING_DELAY_MS - 1);
    expect(result.current).toBe(false);

    rerender({ isLoading: false });
    advance(1_000);

    expect(result.current).toBe(false);
  });

  it("paints the skeleton once the load outlives the delay", () => {
    const { result } = renderHook(() => useDeferredLoading(true));

    expect(result.current).toBe(false);
    advance(DEFERRED_LOADING_DELAY_MS - 1);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });

  it("keeps the skeleton on screen for the minimum time instead of blinking out", () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDeferredLoading(isLoading),
      { initialProps: { isLoading: true } },
    );

    advance(DEFERRED_LOADING_DELAY_MS);
    expect(result.current).toBe(true);

    rerender({ isLoading: false });
    advance(DEFERRED_LOADING_MIN_VISIBLE_MS - 1);
    expect(result.current).toBe(true);

    advance(1);
    expect(result.current).toBe(false);
  });

  it("measures the minimum from the moment it appeared, not from the start of the load", () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDeferredLoading(isLoading),
      { initialProps: { isLoading: true } },
    );

    // Keep loading well past the minimum: the skeleton is already visible.
    advance(DEFERRED_LOADING_DELAY_MS + DEFERRED_LOADING_MIN_VISIBLE_MS * 2);
    expect(result.current).toBe(true);

    rerender({ isLoading: false });
    // The minimum is already spent, so the next tick drops it.
    advance(1);
    expect(result.current).toBe(false);
  });

  it("stays visible when the next load starts while the skeleton is on screen", () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDeferredLoading(isLoading),
      { initialProps: { isLoading: true } },
    );

    advance(DEFERRED_LOADING_DELAY_MS);
    expect(result.current).toBe(true);

    rerender({ isLoading: false });
    advance(100);
    rerender({ isLoading: true });
    advance(1_000);

    expect(result.current).toBe(true);
  });

  it("accepts a custom delay and minimum", () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDeferredLoading(isLoading, { delayMs: 0, minVisibleMs: 50 }),
      { initialProps: { isLoading: true } },
    );

    advance(0);
    expect(result.current).toBe(true);

    rerender({ isLoading: false });
    advance(49);
    expect(result.current).toBe(true);
    advance(1);
    expect(result.current).toBe(false);
  });

  it("never shows a skeleton when the first render already has data", () => {
    const { result } = renderHook(() => useDeferredLoading(false));

    advance(5_000);

    expect(result.current).toBe(false);
  });
});
