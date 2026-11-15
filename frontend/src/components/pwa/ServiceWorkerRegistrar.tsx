"use client";

import { useEffect } from "react";
import { PWA_SCOPE, SW_PATH } from "@/lib/pwa";
import {
  announceWaitingWorker,
  shouldReloadOnControllerChange,
} from "@/lib/sw-update";

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
 *
 * It also owns the update handshake: a replacement worker is announced to the
 * page (which offers the swap) and the page is reloaded only after the operator
 * asked for it, never because a worker happened to take control.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!canRegister()) return;

    const container = navigator.serviceWorker;

    // `controllerchange` also fires on a first install, when `clients.claim()`
    // takes over a page that had no controller. Reloading then would look like
    // a crash, so the reload is gated on an explicit swap request.
    const onControllerChange = () => {
      if (shouldReloadOnControllerChange()) window.location.reload();
    };
    container.addEventListener("controllerchange", onControllerChange);

    const watch = (registration: ServiceWorkerRegistration) => {
      // Already waiting when this page booted: the update arrived during a
      // previous session and nobody pressed the button.
      if (registration.waiting && container.controller) {
        announceWaitingWorker(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener("statechange", () => {
          // `controller` is what separates a replacement from a first install:
          // without one there is nothing running to replace.
          if (installing.state === "installed" && container.controller) {
            announceWaitingWorker(installing);
          }
        });
      });
    };

    const register = () => {
      // A rejected registration (unsupported context, denied scope) must never
      // surface: the app works fine without a worker, just without offline.
      container
        .register(SW_PATH, { scope: PWA_SCOPE, updateViaCache: "none" })
        .then(watch)
        .catch(() => undefined);
    };

    if (document.readyState === "complete") {
      register();
    } else {
      // Registering during boot competes with the first paint for bandwidth.
      window.addEventListener("load", register);
    }

    return () => {
      container.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
