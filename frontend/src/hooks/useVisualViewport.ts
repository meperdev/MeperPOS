"use client";

import { useSyncExternalStore } from "react";

/**
 * Tailwind's `sm`. Below it every overlay is a bottom sheet; from it up the
 * desktop dialog and dropdown stay exactly as they were.
 */
const SM_QUERY = "(min-width: 640px)";

function smList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  try {
    return window.matchMedia(SM_QUERY);
  } catch {
    return null;
  }
}

function subscribeBelowSm(onChange: () => void): () => void {
  const list = smList();
  if (!list) return () => {};
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }
  // Safari before 14 only has the deprecated pair.
  list.addListener(onChange);
  return () => list.removeListener(onChange);
}

function belowSmSnapshot(): boolean {
  // No matchMedia (jsdom, an old embedded webview) means the desktop layout,
  // never a sheet nobody can dismiss.
  return smList()?.matches === false;
}

/**
 * True when the viewport is narrower than `sm`.
 *
 * The server and the first client frame answer `false` so markup cannot change
 * shape mid-hydration; the sheet takes over as soon as the browser answers.
 */
export function useBelowSmViewport(): boolean {
  return useSyncExternalStore(subscribeBelowSm, belowSmSnapshot, () => false);
}

function subscribeViewport(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onChange);
  viewport?.addEventListener("scroll", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    viewport?.removeEventListener("resize", onChange);
    viewport?.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/** Pixels of the layout viewport currently hidden behind the on-screen keyboard. */
export function measureKeyboardInset(): number {
  if (typeof window === "undefined") return 0;
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  const hidden = window.innerHeight - (viewport.height + viewport.offsetTop);
  return hidden > 0 ? Math.round(hidden) : 0;
}

/**
 * How much of the page the on-screen keyboard covers.
 *
 * iOS does not resize the layout viewport when the keyboard opens; it shrinks
 * `visualViewport` instead, so a bottom-anchored surface has to lift itself by
 * this amount or it ends up underneath the keyboard.
 */
export function useVisualViewport(): number {
  return useSyncExternalStore(subscribeViewport, measureKeyboardInset, () => 0);
}
