"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ViewMode } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";

/** `sm` — the first width where a collection table is usable in a phone-less layout. */
export const SM_BREAKPOINT_QUERY = "(min-width: 640px)";

function mediaQuery(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(query);
}

/**
 * `addEventListener` is missing in jsdom and in old WebViews; the legacy
 * `addListener` pair is the only subscription left there. With neither, the
 * snapshot is static and no listener is attached.
 */
function subscribeTo(query: string, onChange: () => void) {
  const list = mediaQuery(query);
  if (!list) return () => {};
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }
  if (typeof list.addListener === "function") {
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }
  return () => {};
}

/**
 * One viewport question, answered with the value the caller asked for when the
 * environment cannot measure a viewport at all (server render, jsdom): a page
 * must degrade to its stored state, never to a guess about the screen.
 */
export function useMediaQuery(query: string, whenUnmeasurable = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeTo(query, onChange),
    [query],
  );
  const snapshot = useCallback(
    () => mediaQuery(query)?.matches ?? whenUnmeasurable,
    [query, whenUnmeasurable],
  );

  return useSyncExternalStore(subscribe, snapshot, () => whenUnmeasurable);
}

/**
 * The layout a collection page actually renders. Below `sm` that is always the
 * card list: a table at 390px is a sideways scroller on a phone, and the toggle
 * that would switch back is hidden there. The stored preference is untouched,
 * so the table returns by itself on a wider screen.
 */
export function useEffectiveViewMode(key: string, fallback: ViewMode = "grid") {
  const [viewMode, setViewMode] = usePersistedViewMode(key, fallback);
  const isWide = useMediaQuery(SM_BREAKPOINT_QUERY);
  const effective: ViewMode = isWide ? viewMode : "grid";
  return [effective, setViewMode] as const;
}
