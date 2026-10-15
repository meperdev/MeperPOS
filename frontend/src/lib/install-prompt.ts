/**
 * Detection and typing for the PWA install surface.
 *
 * Kept separate from the provider so the platform predicates stay pure and can
 * be reasoned about without React.
 */

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
  /** The browser offered its own install prompt and it can still be replayed. */
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
  const legacyFlag = (window.navigator as { standalone?: boolean } | undefined)
    ?.standalone;
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
export function subscribeToDisplayMode(onChange: () => void): () => void {
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
export function serverIsStandalone(): boolean {
  return false;
}

/**
 * Prerendering has no `navigator`, so the platform is unknowable on the server.
 *
 * Reading a user agent during render is what desynchronises hydration: the
 * prerendered HTML would say "not iOS" while an iOS client's very first render
 * says otherwise. This snapshot, paired with `useSyncExternalStore`, keeps the
 * two passes in agreement and lets the real value arrive afterwards.
 */
export function serverIsNotIos(): boolean {
  return false;
}

/**
 * A subscription for a value that cannot change while the app is running.
 *
 * The platform is fixed for the lifetime of the page, so there is nothing to
 * listen to; `useSyncExternalStore` is used here purely for its server-snapshot
 * contract, not for updates.
 */
export function subscribeToNothing(): () => void {
  return () => undefined;
}

/**
 * Compares a captured event with the one already consumed.
 *
 * `beforeinstallprompt` is single-use, and React state is not a synchronous
 * latch, so two calls inside the same tick would otherwise both get through.
 */
export function isConsumedEvent(
  consumed: BeforeInstallPromptEvent | null,
  candidate: BeforeInstallPromptEvent | null,
): boolean {
  return candidate !== null && consumed === candidate;
}

/** The shape returned when no provider is mounted. */
export const UNAVAILABLE_INSTALL_STATE: InstallPromptState = {
  isInstalled: false,
  canPromptInstall: false,
  needsManualInstall: false,
  isAvailable: false,
  promptInstall: async () => "unavailable",
};
