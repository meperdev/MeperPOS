"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ViewMode } from "@/components/ui/ViewModeToggle";

/**
 * Display preference, not data state: it survives navigation without ever
 * hiding records (a persisted filter could leave a page looking empty).
 * Stored per page so each collection remembers its own layout.
 */
const STORAGE_PREFIX = "meperpos:view-mode:";
const listeners = new Set<() => void>();

function readViewMode(key: string, fallback: ViewMode): ViewMode {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + key);
    return stored === "grid" || stored === "table" ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function usePersistedViewMode(key: string, fallback: ViewMode = "grid") {
  const subscribe = useCallback((onChange: () => void) => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  // Primitive snapshot: stable between writes, so no render loop.
  const viewMode = useSyncExternalStore(
    subscribe,
    () => readViewMode(key, fallback),
    () => fallback,
  );

  const setViewMode = useCallback(
    (next: ViewMode) => {
      try {
        window.localStorage.setItem(STORAGE_PREFIX + key, next);
      } catch {
        // Storage can be blocked; the in-memory snapshot below still updates.
      }
      listeners.forEach((listener) => listener());
    },
    [key],
  );

  return [viewMode, setViewMode] as const;
}
