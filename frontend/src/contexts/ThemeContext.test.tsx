import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { PWA_THEME_COLOR_DARK, PWA_THEME_COLOR_LIGHT } from "@/lib/pwa";

/** jsdom implements no `matchMedia`; the provider asks for the OS preference. */
function stubMatchMedia(matches = false) {
  window.matchMedia = vi.fn((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** The pair Next emits at boot (see `buildPwaViewport`). */
function mountThemeColorTags() {
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((tag) => tag.remove());
  for (const media of ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"]) {
    const tag = document.createElement("meta");
    tag.setAttribute("name", "theme-color");
    tag.setAttribute("media", media);
    tag.setAttribute("content", media.includes("dark") ? PWA_THEME_COLOR_DARK : PWA_THEME_COLOR_LIGHT);
    document.head.appendChild(tag);
  }
}

function themeColorContents(): string[] {
  return Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(
    (tag) => tag.getAttribute("content") ?? "",
  );
}

function ToggleProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      {`Tema: ${theme}`}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia(false);
  document.documentElement.classList.remove("dark");
  mountThemeColorTags();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((tag) => tag.remove());
});

describe("theme-color follows the in-app theme (S1.4)", () => {
  it("repaints every theme-color tag with the dark background on toggle", async () => {
    render(
      <ThemeProvider>
        <ToggleProbe />
      </ThemeProvider>,
    );

    expect(themeColorContents()).toEqual([
      PWA_THEME_COLOR_LIGHT,
      PWA_THEME_COLOR_LIGHT,
    ]);

    await userEvent.click(screen.getByRole("button", { name: /Tema: light/ }));

    expect(themeColorContents()).toEqual([
      PWA_THEME_COLOR_DARK,
      PWA_THEME_COLOR_DARK,
    ]);
  });

  it("returns to the light background when the theme toggles back", async () => {
    render(
      <ThemeProvider>
        <ToggleProbe />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Tema: light/ }));
    await userEvent.click(screen.getByRole("button", { name: /Tema: dark/ }));

    expect(themeColorContents()).toEqual([
      PWA_THEME_COLOR_LIGHT,
      PWA_THEME_COLOR_LIGHT,
    ]);
  });

  it("keeps the media pairs for first paint instead of replacing the tag", async () => {
    render(
      <ThemeProvider>
        <ToggleProbe />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Tema: light/ }));

    const medias = Array.from(
      document.querySelectorAll('meta[name="theme-color"]'),
    ).map((tag) => tag.getAttribute("media"));
    expect(medias).toEqual([
      "(prefers-color-scheme: light)",
      "(prefers-color-scheme: dark)",
    ]);
  });

  // Next re-emits the viewport metadata on every soft navigation, which puts the
  // boot pair back. Without this the status bar would flip to the light color on
  // the first client-side route change of a dark session.
  it("repaints tags that a later metadata emission puts back", async () => {
    render(
      <ThemeProvider>
        <ToggleProbe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Tema: light/ }));

    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((tag) => tag.remove());
    mountThemeColorTags();

    await waitFor(() => {
      expect(themeColorContents()).toEqual([
        PWA_THEME_COLOR_DARK,
        PWA_THEME_COLOR_DARK,
      ]);
    });
  });
});

describe("ThemeContext preserved behavior", () => {
  it("still toggles the dark class and remembers the choice", async () => {
    render(
      <ThemeProvider>
        <ToggleProbe />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Tema: light/ }));

    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("starts from the stored theme", () => {
    localStorage.setItem("theme", "dark");
    render(
      <ThemeProvider>
        <ToggleProbe />
      </ThemeProvider>,
    );

    expect(document.documentElement).toHaveClass("dark");
    expect(themeColorContents()).toEqual([
      PWA_THEME_COLOR_DARK,
      PWA_THEME_COLOR_DARK,
    ]);
  });
});
