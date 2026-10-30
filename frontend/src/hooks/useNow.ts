"use client";

import { useSyncExternalStore } from "react";

/**
 * A coarse clock the render path may read without calling an impure function
 * during render. One shared interval drives every subscriber, and the snapshot
 * is a primitive so React can compare it by value.
 */
let current = Date.now();
const listeners = new Set<() => void>();
let started = false;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!started && typeof window !== "undefined") {
    started = true;
    current = Date.now();
    window.setInterval(() => {
      current = Date.now();
      listeners.forEach((listener) => listener());
    }, 60_000);
  }
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot() {
  return current;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
