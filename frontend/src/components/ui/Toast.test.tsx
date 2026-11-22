import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastCard, type ToastType } from "./Toast";

const globalsCss = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** The declarations inside one top-level CSS block, comments included. */
function cssBlock(selector: string) {
  const start = globalsCss.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = globalsCss.indexOf("\n}", start);
  return globalsCss.slice(start, end);
}

function cssValue(block: string, name: string) {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  return match ? match[1].trim() : null;
}

/** Resolve one level of `var(--token)` against the light block, where it is defined. */
function resolveToken(name: string, scope: "light" | "dark") {
  const lightBlock = cssBlock(":root");
  const darkBlock = cssBlock(".dark");
  const raw = (scope === "dark" ? cssValue(darkBlock, name) : null) ?? cssValue(lightBlock, name);
  expect(raw, `--${name} is missing`).not.toBeNull();
  const reference = /^var\(--([\w-]+)\)$/.exec(raw as string);
  return reference ? cssValue(lightBlock, reference[1]) : (raw as string);
}

function relativeLuminance(hex: string) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)!
    .map((pair) => parseInt(pair, 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastWithWhite(hex: string) {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

const TONES: Array<{ type: ToastType; tile: string; token: string }> = [
  { type: "success", tile: "toast-success", token: "toast-success-tile" },
  { type: "error", tile: "toast-danger", token: "toast-danger-tile" },
  { type: "warning", tile: "toast-warning", token: "toast-warning-tile" },
  { type: "info", tile: "toast-info", token: "toast-info-tile" },
];

describe("ToastCard", () => {
  it.each(TONES)("paints the $type tile from its own token with a white glyph", ({ type, tile }) => {
    render(<ToastCard type={type} title="Título" onClose={vi.fn()} />);

    const iconTile = screen.getByTestId("toast-icon-tile");
    expect(iconTile.className).toContain(`bg-${tile}`);
    expect(iconTile.className).toContain("text-white");
    expect(iconTile.className).toContain("h-9");
    expect(iconTile.className).toContain("w-9");
    expect(iconTile.className).toContain("rounded-lg");
    expect(iconTile.querySelector("svg")).not.toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "keeps the glyph at 3:1 or better on every tile in %s mode",
    (scope) => {
      for (const tone of TONES) {
        expect(contrastWithWhite(resolveToken(tone.token, scope)!)).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("renders a title and an optional description", () => {
    render(
      <ToastCard
        type="success"
        title="Cambios guardados"
        description="El precio quedó actualizado."
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Cambios guardados").className).toContain("font-semibold");
    expect(screen.getByText("El precio quedó actualizado.").className).toContain(
      "text-muted-foreground",
    );
  });

  it("runs the action before dismissing the card", () => {
    const calls: string[] = [];
    render(
      <ToastCard
        type="error"
        title="No se pudo subir"
        action={{ label: "Reintentar", onClick: () => calls.push("action") }}
        onClose={() => calls.push("close")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(calls).toEqual(["action", "close"]);
  });

  it("closes from a labelled button that only appears on hover, focus or touch", () => {
    const onClose = vi.fn();
    render(<ToastCard type="info" title="Aviso" onClose={onClose} />);

    const close = screen.getByRole("button", { name: "Cerrar notificación" });
    expect(close.className).toContain("opacity-0");
    expect(close.className).toContain("group-hover/toast:opacity-100");
    expect(close.className).toContain("group-focus-within/toast:opacity-100");
    expect(close.className).toContain("[@media(hover:none)]:opacity-100");

    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("carries no countdown bar", () => {
    const { container } = render(<ToastCard type="error" title="Falló" onClose={vi.fn()} />);

    expect(container.querySelector(".animate-toast-progress")).toBeNull();
    expect(container.querySelector('[style*="animation"]')).toBeNull();
  });

  it("peeks behind the front card anchored to its bottom edge at a fixed offset per depth", () => {
    const { rerender } = render(<ToastCard type="info" title="Frente" onClose={vi.fn()} />);
    const front = screen.getByTestId("toast-card");
    expect(front.className).toContain("relative");
    expect(front.style.transform).toBe("");

    rerender(<ToastCard type="info" title="Frente" depth={1} onClose={vi.fn()} />);
    const behind = screen.getByTestId("toast-card");
    expect(behind.className).toContain("absolute");
    expect(behind.className).toContain("inset-0");
    expect(behind.className).toContain("origin-bottom");
    expect(behind.className).toContain("overflow-hidden");
    expect(behind.className).toContain("pointer-events-none");
    expect(behind.style.transform).toBe("translateY(12px) scale(0.95)");

    rerender(<ToastCard type="info" title="Frente" depth={2} onClose={vi.fn()} />);
    expect(screen.getByTestId("toast-card").style.transform).toBe("translateY(24px) scale(0.9)");
  });

  it("fades a leaving peeking card behind the front card without playing toast-out", () => {
    const { rerender } = render(
      <ToastCard type="info" title="Detrás" depth={1} leaving onClose={vi.fn()} />,
    );
    const peekingLeaving = screen.getByTestId("toast-card");
    expect(peekingLeaving.className).not.toContain("animate-toast-out");
    expect(peekingLeaving.style.opacity).toBe("0");
    expect(peekingLeaving.style.transform).toBe("translateY(12px) scale(0.95)");

    rerender(<ToastCard type="info" title="Expandida" depth={1} expanded leaving onClose={vi.fn()} />);
    const expandedLeaving = screen.getByTestId("toast-card");
    expect(expandedLeaving.className).toContain("animate-toast-out");
  });

  it("drops the travel but keeps the fade under prefers-reduced-motion", () => {
    expect(globalsCss).toContain("translateY(-12px)");

    const reduced = globalsCss.slice(globalsCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    const start = reduced.indexOf(".animate-toast-in");
    expect(start).toBeGreaterThanOrEqual(0);
    const toastRules = reduced.slice(start, start + 240);

    expect(toastRules).toContain("toast-fade-in");
    expect(toastRules).toContain("toast-fade-out");
    expect(toastRules).not.toContain("translateY");
  });

  it("zones errors as alerts and the rest as status", () => {
    const { rerender } = render(<ToastCard type="error" title="Falló" onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<ToastCard type="warning" title="Cuidado" onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
