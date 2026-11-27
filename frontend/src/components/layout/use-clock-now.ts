"use client";

import { useSyncExternalStore } from "react";

// The chrome clock is a store of the current minute. The server snapshot is
// null, so SSR and hydration render no time; the client fills it in after
// hydration. The rail drawer and the desktop header read the same store.
const CLOCK_TICK_MS = 60_000;

function subscribeToClock(onTick: () => void) {
  const intervalId = window.setInterval(onTick, CLOCK_TICK_MS);
  return () => window.clearInterval(intervalId);
}

function getClockMinute() {
  return Math.floor(Date.now() / CLOCK_TICK_MS);
}

function getServerClockMinute(): null {
  return null;
}

/** The current minute as a `Date`, or `null` before the client has mounted. */
export function useClockNow(): Date | null {
  const clockMinute = useSyncExternalStore(
    subscribeToClock,
    getClockMinute,
    getServerClockMinute,
  );
  return clockMinute === null ? null : new Date(clockMinute * CLOCK_TICK_MS);
}
