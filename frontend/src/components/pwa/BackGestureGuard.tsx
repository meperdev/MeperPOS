"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { isStandaloneDisplay } from "@/lib/install-prompt";

/**
 * Routes with nothing of the app behind them. The iOS edge swipe is a plain
 * history navigation, so at these the system gesture closes the app or returns
 * to the browser instead of doing anything useful.
 */
const GUARDED_PATHS = ["/", "/login", "/register", "/dashboard", "/pos"];

const SENTINEL = { __meperposAppEntry: true };

/**
 * Keeps the back gesture inside the app where leaving only ever costs the
 * operator their session.
 *
 * iOS routes the left-edge swipe through history, with no event a page can veto.
 * The working approach is to keep one entry behind the current route so the
 * gesture lands on that entry instead of exiting: the pop is followed by a fresh
 * push, and the app stays where it was.
 *
 * Deliberately scoped to the routes above rather than applied globally: internal
 * back navigation is useful and must keep working, and it already does because
 * every other route is allowed to pop back to the one behind it.
 *
 * Only active in a standalone launch. In a browser tab the back button belongs
 * to the browser, and stealing it would be a bug, not a feature.
 */
export function BackGestureGuard() {
  const pathname = usePathname();
  const guarded = GUARDED_PATHS.includes(pathname ?? "");

  useEffect(() => {
    if (!guarded) return;
    if (!isStandaloneDisplay()) return;
    if (typeof window === "undefined") return;

    window.history.pushState(SENTINEL, "");

    const onPopState = () => {
      // The gesture already consumed the entry; put it back so a second swipe
      // behaves the same way instead of leaving.
      window.history.pushState(SENTINEL, "");
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [guarded, pathname]);

  return null;
}
