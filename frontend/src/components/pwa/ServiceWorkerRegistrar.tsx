"use client";

import { useEffect } from "react";
import { PWA_SCOPE, SW_PATH } from "@/lib/pwa";

/**
 * Registration is production-only on purpose. A worker wired to the dev server
 * would cache HMR chunks and make the running app misrepresent the code on
 * disk, which is a far worse failure than not having offline support in dev.
 */
function canRegister(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator
  );
}

/**
 * Headless component that owns the service worker lifecycle. It renders nothing
 * and lives in the root layout so registration happens exactly once per app
 * load, on both a cold launch and an installed-app launch.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!canRegister()) return;

    const register = () => {
      // A rejected registration (unsupported context, denied scope) must never
      // surface: the app works fine without a worker, just without offline.
      navigator.serviceWorker
        .register(SW_PATH, { scope: PWA_SCOPE, updateViaCache: "none" })
        .catch(() => undefined);
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    // Registering during boot competes with the first paint for bandwidth.
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
