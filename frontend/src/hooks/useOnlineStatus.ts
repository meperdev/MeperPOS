"use client";

import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);

  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

/**
 * `navigator` does not exist while prerendering, and a first client render that
 * disagreed with the server HTML would be a hydration mismatch on every route.
 * Claiming a connection is the only safe default: the store re-reads the real
 * value immediately after hydration.
 */
function getServerSnapshot() {
  return true;
}

/**
 * Whether the browser currently believes it has a network. This is the
 * browser's own signal, so it reports a lost Wi-Fi link or an airplane-mode
 * toggle, not a reachable backend: a captive portal reads as online.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
