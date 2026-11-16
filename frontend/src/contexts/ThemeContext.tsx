"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { safeGetItem, safeSetItem } from "@/lib/utils";
import { PWA_THEME_COLOR_DARK, PWA_THEME_COLOR_LIGHT } from "@/lib/pwa";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Repaints the `theme-color` meta tags with the theme that is actually active.
 *
 * Next emits a light/dark pair driven by `prefers-color-scheme` (see
 * `buildPwaViewport`), which is the best it can do before React runs. After
 * that the in-app toggle outranks the OS preference, so every tag — media pair
 * included — carries the active theme's `--background`. The media attributes
 * stay in place: they are what the next cold first paint reads.
 *
 * Writing only what differs is what makes the head observer below terminate:
 * its own write is a mutation too, and a second pass finds nothing to change.
 */
function applyThemeColor(theme: Theme): void {
  const color =
    theme === "dark" ? PWA_THEME_COLOR_DARK : PWA_THEME_COLOR_LIGHT;
  document.querySelectorAll('meta[name="theme-color"]').forEach((tag) => {
    if (tag.getAttribute("content") !== color) tag.setAttribute("content", color);
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const saved = safeGetItem("theme") as Theme;
      if (saved) return saved;
      // Respect browser preference; fall back to light
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return "light";
  });

  useEffect(() => {
    safeSetItem("theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
    applyThemeColor(theme);

    /**
     * Next re-emits the viewport metadata on every client-side navigation, which
     * puts the boot media pair back and would leave a dark session with a light
     * status bar. Watching the head keeps the active theme authoritative — at
     * every route, not only at mount — and costs nothing while it is unchanged.
     */
    const observer = new MutationObserver(() => applyThemeColor(theme));
    observer.observe(document.head, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
