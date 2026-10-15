import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import manifestRoute from "@/app/manifest";
import {
  APP_ICON_APPLE,
  PWA_BACKGROUND_COLOR,
  PWA_ICONS,
  PWA_OFFLINE_URL,
  PWA_SCOPE,
  PWA_START_URL,
  PWA_THEME_COLOR_DARK,
  PWA_THEME_COLOR_LIGHT,
  SW_CACHE_VERSION,
  SW_PAGES_CACHE,
  SW_STATIC_CACHE,
  buildPwaMetadata,
  buildPwaViewport,
} from "@/lib/pwa";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";

/** The route module Next serves at /manifest.webmanifest. */
const manifest = manifestRoute();

/** Reads PNG intrinsic dimensions straight out of the IHDR chunk. */
function pngSize(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath);
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function publicFile(src: string): string {
  return path.resolve(process.cwd(), "public", src.replace(/^\//, ""));
}

describe("web app manifest", () => {
  it("declares the fields Chrome requires to offer installation", () => {
    expect(manifest.name).toBe(APP_NAME);
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.short_name!.length).toBeLessThanOrEqual(12);
    expect(manifest.description).toBe(APP_DESCRIPTION);
    expect(manifest.start_url).toBe(PWA_START_URL);
    expect(manifest.scope).toBe(PWA_SCOPE);
    expect(manifest.display).toBe("standalone");
    expect(manifest.lang).toBe("es-CO");
    expect(manifest.theme_color).toBe(PWA_THEME_COLOR_LIGHT);
    expect(manifest.background_color).toBe(PWA_BACKGROUND_COLOR);
  });

  it("keeps start_url inside the declared scope", () => {
    expect(manifest.start_url!.startsWith(PWA_SCOPE)).toBe(true);
    expect(manifest.scope).toBe("/");
  });

  it("exposes the icon set from the single source of truth", () => {
    expect(manifest.icons).toEqual(PWA_ICONS);
  });

  it("ships at least one 192px and one 512px icon, one of them maskable", () => {
    const any192 = PWA_ICONS.filter((icon) => icon.sizes === "192x192");
    const any512 = PWA_ICONS.filter((icon) => icon.sizes === "512x512");
    const maskable = PWA_ICONS.filter((icon) => icon.purpose === "maskable");

    expect(any192.length).toBeGreaterThanOrEqual(1);
    expect(any512.length).toBeGreaterThanOrEqual(1);
    expect(maskable.some((icon) => icon.sizes === "512x512")).toBe(true);
  });

  it("ships every declared icon as a real PNG of its declared size", () => {
    for (const icon of PWA_ICONS) {
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(icon.type).toBe("image/png");
      expect(icon.src.startsWith("/")).toBe(true);
      expect(pngSize(publicFile(icon.src))).toEqual({ width, height });
    }
  });
});

describe("iOS install metadata", () => {
  it("ships a 180px Apple touch icon", () => {
    expect(
      pngSize(path.resolve(process.cwd(), "src/app", `${APP_ICON_APPLE}.png`)),
    ).toEqual({ width: 180, height: 180 });
  });

  it("declares standalone mode so iOS never opens the installed app in Safari chrome", () => {
    // `appleWebApp` is typed `boolean | AppleWebApp`, so match the shape
    // instead of reading properties off the union.
    expect(buildPwaMetadata().appleWebApp).toMatchObject({
      capable: true,
      title: APP_NAME,
      statusBarStyle: "default",
    });
  });

  it("keeps the dynamic island and home indicator free through viewportFit cover", () => {
    expect(buildPwaViewport().viewportFit).toBe("cover");
  });
});

describe("theme color single source of truth", () => {
  it("routes both viewport theme colors through the shared constants", () => {
    expect(buildPwaViewport().themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: PWA_THEME_COLOR_LIGHT },
      { media: "(prefers-color-scheme: dark)", color: PWA_THEME_COLOR_DARK },
    ]);
  });

  it("hardcodes no color literals in the root layout", () => {
    const layout = readFileSync(
      path.resolve(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );

    expect(layout).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(layout).toContain('from "@/lib/pwa"');
  });
});

describe("service worker contract", () => {
  const swSource = readFileSync(
    path.resolve(process.cwd(), "public/sw.js"),
    "utf8",
  );

  it("derives both cache names from the shared version constant", () => {
    expect(swSource).toContain(`const CACHE_VERSION = "${SW_CACHE_VERSION}";`);
    expect(swSource).toContain("meperpos-static-${CACHE_VERSION}");
    expect(swSource).toContain("meperpos-pages-${CACHE_VERSION}");
  });

  it("hardcodes no cache name outside the version constant", () => {
    // A literal like `meperpos-static-v1` would silently survive a version
    // bump and keep serving the superseded cache forever.
    expect(swSource).not.toMatch(/meperpos-(static|pages)-v\d/);
  });

  it("matches the cache names the browser will actually see", () => {
    expect(SW_STATIC_CACHE).toBe(`meperpos-static-${SW_CACHE_VERSION}`);
    expect(SW_PAGES_CACHE).toBe(`meperpos-pages-${SW_CACHE_VERSION}`);
  });

  it("precaches URLs the build really serves", () => {
    expect(swSource).toContain(`"${PWA_OFFLINE_URL}"`);
    expect(swSource).toContain('const MANIFEST_URL = "/manifest.webmanifest";');

    // Precache failures are swallowed on purpose, so a URL that 404s would
    // disable the offline fallback with no visible symptom.
    expect(
      existsSync(
        path.resolve(
          process.cwd(),
          "src/app",
          PWA_OFFLINE_URL.slice(1),
          "page.tsx",
        ),
      ),
    ).toBe(true);
    expect(existsSync(path.resolve(process.cwd(), "src/app/manifest.ts"))).toBe(
      true,
    );
  });

  it("keeps the /api guard that protects tenant data", () => {
    expect(swSource).toContain('url.pathname.startsWith("/api/")');
    expect(swSource).toContain("url.origin !== self.location.origin");
  });
});
