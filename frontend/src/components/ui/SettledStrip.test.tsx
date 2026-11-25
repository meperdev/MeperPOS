import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettledStrip } from "./SettledStrip";

describe("SettledStrip", () => {
  it("occupies exactly the in-progress bar plus caption slot", () => {
    render(<SettledStrip label="Pagado completo" testId="settled" />);

    const strip = screen.getByTestId("settled");
    // h-7 is 28px: the in-progress bar (6px) + its gap (6px) + caption (16px),
    // so a settled card and a pending one in the same grid row stay aligned.
    expect(strip).toHaveClass("h-7", "w-full");
    expect(strip).toHaveClass("flex", "items-center", "gap-2");
    expect(strip).toHaveClass("rounded-md", "border", "border-border/60");
    expect(strip).toHaveClass("bg-muted/40", "px-2.5");
  });

  it("marks settled with one small success dot holding the check", () => {
    render(<SettledStrip label="Pagado completo" testId="settled" />);

    const dot = screen
      .getByTestId("settled")
      .querySelector("span[aria-hidden='true']") as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass("grid", "h-4", "w-4", "place-items-center");
    expect(dot).toHaveClass("rounded-full", "bg-success/15", "text-success-text");

    // The dot is the only colour on the strip, and the glyph stays small.
    const icon = dot.querySelector("svg") as SVGElement;
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("h-3", "w-3");
  });

  it("states the label and pushes the date to the right edge", () => {
    render(
      <SettledStrip
        label="Pagado completo"
        date="16 nov 2026"
        testId="settled"
      />,
    );

    const strip = screen.getByTestId("settled");
    const label = screen.getByText("Pagado completo");
    expect(label).toHaveClass("text-xs", "font-medium", "text-foreground/80");

    const date = screen.getByText("16 nov 2026");
    expect(date).toHaveClass("ml-auto", "text-xs", "text-muted-foreground");
    // Proportional figures: a date reads as text, never as a mono column.
    expect(date).not.toHaveClass("tabular-nums");
    // The two sit on opposite edges, joined by the layout and no "·".
    expect(strip.textContent).toBe("Pagado completo16 nov 2026");
    expect(date.previousElementSibling).toBe(label);
  });

  it("omits the date entirely when the card carries none", () => {
    render(<SettledStrip label="Saldado" testId="settled" />);

    const strip = screen.getByTestId("settled");
    expect(strip.textContent).toBe("Saldado");
    expect(strip.querySelector(".ml-auto")).toBeNull();
  });

  it("keeps the given test id and merges an extra className", () => {
    render(
      <SettledStrip
        label="Recibida completa"
        testId="po-settled-line"
        className="mt-1"
      />,
    );

    expect(screen.getByTestId("po-settled-line")).toHaveClass("mt-1", "h-7");
  });
});
