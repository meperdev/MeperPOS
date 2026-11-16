/**
 * Haptics, the smallest possible scratch of the phone feeling native.
 *
 * `navigator.vibrate` exists on Android browsers and nowhere else — iOS Safari
 * has never shipped it, and desktop browsers answer `false` — so every call
 * site treats this as fire-and-forget. Nothing waits on it and nothing fails
 * because of it: a till that loses a sale because a vibration was refused would
 * be a much worse trade than a missing buzz.
 *
 * Patterns are short on purpose (see D6, motion is restrained): one pulse for a
 * tap, a two-pulse answer for success, a two-pulse warning. They are expressed
 * in milliseconds, `[...vibrate, ...pause, ...vibrate]`.
 */
export type HapticKind = "tap" | "success" | "warning";

export const HAPTIC_PATTERNS: Record<HapticKind, number[]> = {
  /** A control was pressed and something changed locally. */
  tap: [10],
  /** The sale is recorded / the operation the user was waiting for is done. */
  success: [12, 48, 22],
  /** Something was removed. Two beats, slightly longer: this one is a warning. */
  warning: [22, 56, 22],
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Reduced motion covers feedback that moves *and* feedback felt through the
 * hand: a phone that buzzes when the user asked it to stop is a bug, not a
 * flourish. `matchMedia` is missing in some test runtimes, hence the guard.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Fires one short vibration. A no-op where the device cannot buzz. */
export function haptic(kind: HapticKind): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  if (prefersReducedMotion()) {
    return;
  }
  try {
    navigator.vibrate(HAPTIC_PATTERNS[kind]);
  } catch {
    // A browser may refuse the call (permissions, background tab). Feedback
    // that cannot happen must never break the action that asked for it.
  }
}
