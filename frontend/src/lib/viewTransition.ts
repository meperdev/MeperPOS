/**
 * Route cross-fade on top of the View Transitions API.
 *
 * Next 16.4 ships no `experimental.viewTransition` switch (nothing in
 * `node_modules/next` reads it), so the transition is started here, around the
 * navigation the shell performs. Two rules hold the whole thing up:
 *
 * 1. **Only the content fades.** The fixed chrome carries its own
 *    `view-transition-name`, which lifts it out of the root snapshot; the bars
 *    then stay perfectly still while the page underneath cross-fades. The
 *    animation itself lives in `globals.css`.
 * 2. **Nothing degrades.** Without the API — Safari before 18.2, Firefox behind
 *    a flag, every jsdom test — the navigation happens exactly as it would
 *    have without this module. Same for `prefers-reduced-motion`.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type ViewTransitionStarter = (
  callback?: () => void | Promise<void>,
) => unknown;

interface ViewTransitionHandle {
  ready?: Promise<unknown>;
  finished?: Promise<unknown>;
}

/**
 * Reads the API off `document` without depending on the DOM lib shipping its
 * type: typing it as an optional member of an intersection keeps the "not
 * there" case a value instead of a compile error.
 */
function viewTransitionStarter(): ViewTransitionStarter | undefined {
  if (typeof document === "undefined") return undefined;
  const start = (document as unknown as { startViewTransition?: unknown })
    .startViewTransition;
  // Bound on purpose: this is a method of the document, and calling it detached
  // throws "Illegal invocation" in Chromium — which the first real-browser run
  // of this feature proved the hard way.
  return typeof start === "function"
    ? (start as ViewTransitionStarter).bind(document)
    : undefined;
}

/**
 * How many frames the "after" snapshot may wait for the new route. The browser
 * takes that snapshot when the callback's promise settles, so resolving on the
 * first frame would photograph the page the user is leaving. The budget is also
 * the guard: a route that never commits must not hold the transition open.
 */
const COMMIT_FRAME_BUDGET = 10;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Resolves once the route committed, or when the frame budget runs out. */
function waitForRouteCommit(previousPath: string): Promise<void> {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let frames = 0;
    const tick = () => {
      frames += 1;
      if (window.location.pathname !== previousPath || frames >= COMMIT_FRAME_BUDGET) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** True when this browser can cross-fade and the user allows motion. */
export function canAnimateRouteTransition(): boolean {
  if (!viewTransitionStarter()) return false;
  return !prefersReducedMotion();
}

/**
 * Runs `navigate` inside a view transition when the browser supports one.
 * Returns whether a transition started; either way the navigation happened, so
 * callers never need a fallback path of their own.
 */
export function startRouteTransition(navigate: () => void): boolean {
  const start = viewTransitionStarter();

  if (!start || prefersReducedMotion()) {
    navigate();
    return false;
  }

  const previousPath =
    typeof window === "undefined" ? "" : window.location.pathname;
  let handle: ViewTransitionHandle | undefined;
  try {
    handle = start(() => {
      navigate();
      return waitForRouteCommit(previousPath);
    }) as ViewTransitionHandle | undefined;
  } catch {
    // A browser that offers the API but refuses this document (a hidden tab, a
    // frame that is being torn down). The click was already taken over, so the
    // navigation has to happen here or the tab would look dead.
    navigate();
    return false;
  }

  // Chromium rejects `finished` whenever it skips or aborts a transition (a
  // slow commit, a background tab). Nothing awaits it, so an unhandled
  // rejection here would be a console error on every such navigation.
  handle?.ready?.catch(() => undefined);
  handle?.finished?.catch(() => undefined);

  return true;
}

/**
 * The click shape a link can afford to take over: a plain primary click. Every
 * other gesture (new tab, new window, middle click, a click something already
 * handled) keeps the browser's own behaviour, because a link that stops opening
 * a new tab is a broken link, not a polish item.
 */
export interface RouteNavigationEvent {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  preventDefault: () => void;
}

/**
 * Navigates through a view transition when the click is a plain one. Returns
 * `false` — after doing nothing at all — when the browser should keep handling
 * the click, so the caller can leave its `<Link>` alone.
 */
export function navigateWithRouteTransition(
  event: RouteNavigationEvent,
  navigate: () => void,
): boolean {
  if (event.defaultPrevented) return false;
  if ((event.button ?? 0) !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (!canAnimateRouteTransition()) return false;

  event.preventDefault();
  startRouteTransition(navigate);
  return true;
}
