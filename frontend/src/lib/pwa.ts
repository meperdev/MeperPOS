import type { Metadata, MetadataRoute, Viewport } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";

/**
 * Single source of truth for the Progressive Web App surface.
 *
 * The manifest route, the root layout metadata and the tests all read these
 * values, so the theme color the browser paints while the app boots can never
 * drift from the color the manifest promises, and the icon list can never
 * describe a file the build does not ship.
 */

/** Matches the `--background` token of the light theme in `globals.css`. */
export const PWA_THEME_COLOR_LIGHT = "#FAF8FF";

/** Matches the `--background` token of the dark theme in `globals.css`. */
export const PWA_THEME_COLOR_DARK = "#111114";

/**
 * Both light and dark boot to the light splash: the installed app paints this
 * color before the first React render, and the theme class is applied after
 * hydration, so a dark splash would flash against a light-themed first frame.
 */
export const PWA_BACKGROUND_COLOR = PWA_THEME_COLOR_LIGHT;

/**
 * `/dashboard` and not `/`: every route is a client component, so an installed
 * app lands on the dashboard and `DashboardLayout` bounces an unauthenticated
 * launch to `/login` on its own.
 */
export const PWA_START_URL = "/dashboard";

export const PWA_SCOPE = "/";

export const PWA_DISPLAY = "standalone";

/**
 * Service worker contract. `public/sw.js` is shipped as a plain script and
 * cannot import from here, so it repeats these literals; the matching test
 * reads that file and fails the moment the two drift apart.
 */
export const SW_PATH = "/sw.js";

export const SW_CACHE_VERSION = "v1";

export const SW_STATIC_CACHE = `meperpos-static-${SW_CACHE_VERSION}`;
export const SW_PAGES_CACHE = `meperpos-pages-${SW_CACHE_VERSION}`;

/** Served by `src/app/offline/page.tsx` and precached on install. */
export const PWA_OFFLINE_URL = "/offline";

export type PwaIconPurpose = "any" | "maskable";

export interface PwaIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: PwaIconPurpose;
}

/**
 * Two shapes per size, because Android treats them differently: `any` icons are
 * drawn as-is, while `maskable` icons are cropped to the launcher's shape and
 * therefore keep the mark inside the safe zone of a filled square.
 */
export const PWA_ICONS: PwaIcon[] = [
  {
    src: "/icons/icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-maskable-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "maskable",
  },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

export function buildManifest(): MetadataRoute.Manifest {
  return {
    id: PWA_SCOPE,
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: "es-CO",
    start_url: PWA_START_URL,
    scope: PWA_SCOPE,
    display: PWA_DISPLAY,
    orientation: "any",
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR_LIGHT,
    icons: PWA_ICONS,
  };
}

export function buildPwaMetadata(): Metadata {
  return {
    title: APP_NAME,
    description: `${APP_NAME} — ${APP_DESCRIPTION}`,
    /**
     * WebKit ignores the manifest's `display` field for the address bar and
     * reads these tags instead. Without them iOS opens the installed app inside
     * Safari chrome.
     */
    appleWebApp: {
      capable: true,
      title: APP_NAME,
      /**
       * `default`, not `black-translucent`: this app has a light theme and a
       * transparent status bar would put dark text over dark content.
       */
      statusBarStyle: "default",
    },
    /**
     * Next maps `appleWebApp.capable` to the standard `mobile-web-app-capable`
     * and emits no vendor-prefixed equivalent (see
     * `node_modules/next/dist/lib/metadata/generate/basic.js`), so the tag WebKit
     * has actually honoured since iOS 1 is declared here. Both are sent: neither
     * replaces the other, and this one is the difference between an installed
     * app and a Safari tab with an icon.
     */
    other: {
      "apple-mobile-web-app-capable": "yes",
    },
  };
}

export function buildPwaViewport(): Viewport {
  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
    /** Lets the layout reach the notch and home indicator areas on iOS. */
    viewportFit: "cover",
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: PWA_THEME_COLOR_LIGHT },
      { media: "(prefers-color-scheme: dark)", color: PWA_THEME_COLOR_DARK },
    ],
  };
}

/**
 * Drops what the service worker cached about *where this operator went*.
 *
 * Only the page cache is dropped, and deliberately so. Its keys are the URLs
 * the session navigated to, which on a shared till is the previous user's trail
 * of which screens they opened. The static cache holds nothing but public,
 * content-hashed assets, so wiping it would cost a full re-download and protect
 * nobody.
 *
 * Called by `clearSessionState`, which owns session teardown. It fires and
 * forgets: ending a session must never wait on storage, and must never fail
 * because storage refused.
 */
export function clearSessionPageCache(): void {
  if (typeof caches === "undefined") return;
  void caches.delete(SW_PAGES_CACHE).catch(() => undefined);
}
