"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/**
 * Chromium's install prompt event. It is not part of lib.dom, and it is not a
 * `CustomEvent`, so the browser's own shape is declared here.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallPromptState {
  /** The app is already running as an installed app, or was just installed. */
  isInstalled: boolean;
  /** The browser offered its own install prompt and it can be replayed. */
  canPromptInstall: boolean;
  /** The platform has no install prompt, so the user needs the manual recipe. */
  needsManualInstall: boolean;
  /** Whether offering installation at all makes sense right now. */
  isAvailable: boolean;
  promptInstall: () => Promise<InstallOutcome>;
}

const STANDALONE_QUERIES = [
  "(display-mode: standalone)",
  "(display-mode: minimal-ui)",
  "(display-mode: fullscreen)",
];

/** An app launched from the home screen matches one of the display modes. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;

  // WebKit does not implement the display-mode media query for this case; it
  // exposes this non-standard flag instead.
  const legacyFlag = (window.navigator as { standalone?: boolean }).standalone;
  if (legacyFlag === true) return true;

  if (typeof window.matchMedia !== "function") return false;
  return STANDALONE_QUERIES.some((query) => window.matchMedia(query).matches);
}

/**
 * iPadOS reports a desktop "Macintosh" user agent to get desktop sites, so the
 * touch-point count is the only reliable way to tell an iPad from a Mac.
 */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent ?? "";
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;

  return /Macintosh/.test(userAgent) && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * Display mode is external state owned by the browser, so it is read through
 * `useSyncExternalStore` rather than mirrored into an effect: an installed app
 * that is uninstalled, or a browser tab that becomes an installed app, both
 * change this without React being told.
 *
 * It is a module-level function so its identity is stable across renders and
 * React does not resubscribe on every one.
 */
function subscribeToDisplayMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const mediaQueries =
    typeof window.matchMedia === "function"
      ? STANDALONE_QUERIES.map((query) => window.matchMedia(query))
      : [];
  for (const query of mediaQueries) {
    query.addEventListener?.("change", onChange);
  }

  return () => {
    for (const query of mediaQueries) {
      query.removeEventListener?.("change", onChange);
    }
  };
}

/** Prerendering has no `window`: nothing is installed during that pass. */
function serverIsStandalone(): boolean {
  return false;
}

/**
 * Tells the caller whether this device can install the app, and how.
 *
 * The two platforms could not be more different: Chromium fires
 * `beforeinstallprompt` and owns the install UI, while WebKit has no such event
 * and no programmatic install at all, so the only thing the app can do there is
 * explain the Share sheet to the user.
 */
export function useInstallPrompt(): InstallPromptState {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installConfirmed, setInstallConfirmed] = useState(false);

  const isStandalone = useSyncExternalStore(
    subscribeToDisplayMode,
    isStandaloneDisplay,
    serverIsStandalone,
  );

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      // Suppressing the browser's mini-infobar is what lets the app offer the
      // install in its own place, with its own wording.
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };

    // On Android the app installs into the launcher while this tab stays an
    // ordinary browser tab, so the display mode never changes and this event is
    // the only signal that installation happened.
    const handleInstalled = () => setInstallConfirmed(true);

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    if (!promptEvent) return "unavailable";

    // The event is single-use whichever way the user answers, so it is dropped
    // before awaiting and can never be replayed.
    setPromptEvent(null);
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    return outcome;
  }, [promptEvent]);

  const isInstalled = isStandalone || installConfirmed;
  const canPromptInstall = promptEvent !== null && !isInstalled;
  const needsManualInstall = !isInstalled && !canPromptInstall && isIosDevice();

  return {
    isInstalled,
    canPromptInstall,
    needsManualInstall,
    isAvailable: canPromptInstall || needsManualInstall,
    promptInstall,
  };
}
