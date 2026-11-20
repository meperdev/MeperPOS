"use client";

import { useEffect, useRef, useState } from "react";

/**
 * How long a load may take before a skeleton is worth painting. Under this, a
 * skeleton and its replacement would arrive in the same blink, which is what
 * reads as "it refreshed three times" even when nothing was wrong.
 */
export const DEFERRED_LOADING_DELAY_MS = 180;

/**
 * Once a skeleton is on screen it stays at least this long. A placeholder that
 * appears and disappears inside a frame is worse than no placeholder at all.
 */
export const DEFERRED_LOADING_MIN_VISIBLE_MS = 400;

export interface DeferredLoadingOptions {
  /** Grace period before the first skeleton paints. */
  delayMs?: number;
  /** Minimum time a painted skeleton remains on screen. */
  minVisibleMs?: number;
}

/**
 * Turns a raw `isLoading` flag into "should a skeleton be on screen right now".
 *
 * - A load that settles inside `delayMs` paints nothing, so fast answers never
 *   flash a placeholder.
 * - A skeleton that did appear stays for `minVisibleMs`, so it cannot blink.
 * - A new load that starts while the skeleton is up keeps it up; the data that
 *   is already rendered is what the caller keeps on screen, not a reset.
 *
 * This only models the first load of a view (`isLoading`). Refetches that keep
 * previous data must never call it with `true`.
 */
export function useDeferredLoading(
  isLoading: boolean,
  { delayMs = DEFERRED_LOADING_DELAY_MS, minVisibleMs = DEFERRED_LOADING_MIN_VISIBLE_MS }: DeferredLoadingOptions = {},
): boolean {
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const visibleSinceRef = useRef(0);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearShow = () => {
      if (showTimerRef.current === null) return;
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    };
    const clearHide = () => {
      if (hideTimerRef.current === null) return;
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    };

    if (isLoading) {
      // A load that starts while the skeleton is up keeps it up: no blink.
      clearHide();
      if (visibleRef.current || showTimerRef.current !== null) return;
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null;
        visibleRef.current = true;
        visibleSinceRef.current = Date.now();
        setVisible(true);
      }, delayMs);
      return;
    }

    clearShow();
    if (!visibleRef.current || hideTimerRef.current !== null) return;

    // Scheduled, never applied inline: a rebuild of this effect must not write
    // state during the render/commit it belongs to.
    const remaining = Math.max(0, minVisibleMs - (Date.now() - visibleSinceRef.current));
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      visibleRef.current = false;
      setVisible(false);
    }, remaining);
  }, [isLoading, delayMs, minVisibleMs]);

  useEffect(
    () => () => {
      if (showTimerRef.current !== null) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
      showTimerRef.current = null;
      hideTimerRef.current = null;
    },
    [],
  );

  return visible;
}
