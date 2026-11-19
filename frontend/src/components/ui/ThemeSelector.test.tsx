import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeProvider } from "@/contexts/ThemeContext";
import { ThemeSelector } from "./ThemeSelector";

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

function renderSelector() {
  return render(
    <ThemeProvider>
      <ThemeSelector />
    </ThemeProvider>,
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("ThemeSelector (S5)", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia(false);
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    document.documentElement.classList.remove("dark");
  });

  it("exposes the two themes as a radiogroup with the active one checked", () => {
    renderSelector();

    const group = screen.getByRole("radiogroup", { name: "Tema de la interfaz" });
    expect(within(group).getAllByRole("radio").map((item) => item.textContent)).toEqual([
      "Claro",
      "Oscuro",
    ]);
    expect(radio("Claro")).toHaveAttribute("aria-checked", "true");
    expect(radio("Oscuro")).toHaveAttribute("aria-checked", "false");
  });

  it("keeps a roving tab stop on the selected theme only", () => {
    renderSelector();

    expect(radio("Claro")).toHaveAttribute("tabindex", "0");
    expect(radio("Oscuro")).toHaveAttribute("tabindex", "-1");
  });

  it("applies a theme through ThemeContext on click", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(radio("Oscuro"));

    expect(radio("Oscuro")).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("does not rewrite the theme when the active one is picked again", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(radio("Claro"));

    expect(localStorage.getItem("theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("moves the selection with the arrow keys", async () => {
    const user = userEvent.setup();
    renderSelector();

    radio("Claro").focus();
    await user.keyboard("{ArrowRight}");

    expect(radio("Oscuro")).toHaveAttribute("aria-checked", "true");
    expect(radio("Oscuro")).toHaveFocus();
    expect(document.documentElement).toHaveClass("dark");

    await user.keyboard("{ArrowLeft}");

    expect(radio("Claro")).toHaveAttribute("aria-checked", "true");
    expect(radio("Claro")).toHaveFocus();
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("selects the focused theme with Enter and Space", async () => {
    const user = userEvent.setup();
    renderSelector();

    radio("Oscuro").focus();
    await user.keyboard("{Enter}");
    expect(radio("Oscuro")).toHaveAttribute("aria-checked", "true");

    radio("Claro").focus();
    await user.keyboard(" ");
    expect(radio("Claro")).toHaveAttribute("aria-checked", "true");
  });

  it("rings and checks only the selected theme", async () => {
    const user = userEvent.setup();
    renderSelector();

    expect(radio("Claro")).toHaveClass("ring-2", "ring-primary");
    expect(radio("Claro").querySelector("[data-theme-check]")).not.toBeNull();
    expect(radio("Oscuro").querySelector("[data-theme-check]")).toBeNull();

    await user.click(radio("Oscuro"));

    expect(radio("Oscuro")).toHaveClass("ring-2", "ring-primary");
    expect(radio("Oscuro").querySelector("[data-theme-check]")).not.toBeNull();
    expect(radio("Claro").querySelector("[data-theme-check]")).toBeNull();
  });

  it("draws each preview with its own theme tokens, not the active one", () => {
    renderSelector();

    const darkPreview = radio("Oscuro").querySelector("[data-theme-preview]")!;
    const lightPreview = radio("Claro").querySelector("[data-theme-preview]")!;

    // --background of the .dark block in globals.css, while light is active.
    expect(darkPreview).toHaveStyle({ backgroundColor: "#111114" });
    expect(lightPreview).toHaveStyle({ backgroundColor: "#FAFAF9" });
  });

  it("hides the miniature from assistive tech so the label names the radio", () => {
    renderSelector();

    const preview = radio("Claro").querySelector("[data-theme-preview]")!;
    expect(preview).toHaveAttribute("aria-hidden", "true");
  });
});
