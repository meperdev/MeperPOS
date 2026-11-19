import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnimatedNumber } from "./AnimatedNumber";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function stubMediaQuery(answers: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: answers[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function strips(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="animated-number-strip"]'),
  );
}

function delayOf(strip: HTMLElement) {
  return Number(strip.style.transitionDelay.replace("ms", ""));
}

describe("AnimatedNumber", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("renders the exact string once for assistive tech and hides the odometer strips", () => {
    const { container } = render(<AnimatedNumber value="$ 1.234.567" />);

    expect(screen.getAllByText("$ 1.234.567")).toHaveLength(1);
    expect(screen.getByText("$ 1.234.567")).toHaveClass("sr-only");

    const visual = container.querySelector('[data-testid="animated-number-strips"]');
    expect(visual).toHaveAttribute("aria-hidden", "true");
    // Exactly one readable copy of the string, and it is the sr-only node.
    expect(container.querySelectorAll(".sr-only")).toHaveLength(1);
  });

  it("gives every digit a column and leaves punctuation, spaces and signs static", () => {
    const { container } = render(<AnimatedNumber value="$ 1.234" />);

    expect(strips(container)).toHaveLength(4);
    // Each column carries the ten digits top to bottom, so the roll has a target.
    expect(strips(container)[0].textContent).toBe("0123456789");

    const statics = Array.from(
      container.querySelectorAll<HTMLElement>("[data-static-char]"),
    ).map((node) => node.getAttribute("data-static-char"));
    expect(statics).toEqual(["$", " ", "."]);
  });

  it("renders a value without digits as static text only", () => {
    const { container } = render(<AnimatedNumber value="—" />);

    expect(screen.getByText("—", { selector: ".sr-only" })).toHaveClass("sr-only");
    expect(strips(container)).toHaveLength(0);
    expect(
      container.querySelector('[data-static-char="—"]'),
    ).toBeTruthy();
  });

  it("shows the first value without a transition and without a roll", () => {
    const { container } = render(<AnimatedNumber value="$ 43" />);

    const [first, second] = strips(container);
    expect(first.style.transitionProperty).toBe("");
    expect(first.style.transitionDuration).toBe("");
    expect(first).not.toHaveAttribute("data-rolling");
    expect(first.style.transform).toBe("translateY(-4em)");
    expect(second.style.transform).toBe("translateY(-3em)");
    expect(container.querySelector("[data-column-new]")).toBeNull();
  });

  it("rolls every digit column to its new value when the string changes", () => {
    const { container, rerender } = render(<AnimatedNumber value="$ 430" />);

    rerender(<AnimatedNumber value="$ 512" />);

    const [five, one, two] = strips(container);
    expect(five.style.transform).toBe("translateY(-5em)");
    expect(one.style.transform).toBe("translateY(-1em)");
    expect(two.style.transform).toBe("translateY(-2em)");

    expect(five).toHaveAttribute("data-rolling", "true");
    expect(five.style.transitionProperty).toBe("transform");
    expect(five.style.transitionDuration).toBe("600ms");
    expect(five.style.transitionTimingFunction).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
  });

  it("keeps each digit column on its own node so the browser can interpolate", () => {
    const { container, rerender } = render(<AnimatedNumber value="$ 430" />);

    const before = strips(container);
    rerender(<AnimatedNumber value="$ 512" />);
    const after = strips(container);

    // A remount would restart the column with no previous transform, which the
    // browser answers with a jump instead of a roll.
    expect(after).toHaveLength(before.length);
    after.forEach((strip, index) => expect(strip).toBe(before[index]));
  });

  it("staggers the roll right to left so the newest digit leads", () => {
    const { container, rerender } = render(<AnimatedNumber value="$ 430" />);

    rerender(<AnimatedNumber value="$ 512" />);

    const [five, one, two] = strips(container);
    expect(delayOf(two)).toBe(0);
    expect(delayOf(one)).toBeGreaterThan(delayOf(two));
    expect(delayOf(five)).toBeGreaterThan(delayOf(one));
  });

  it("does not roll again when the same value is rendered twice", () => {
    const { container, rerender } = render(<AnimatedNumber value="$ 430" />);

    rerender(<AnimatedNumber value="$ 430" />);

    expect(strips(container)[0]).not.toHaveAttribute("data-rolling");
    expect(strips(container)[0].style.transitionProperty).toBe("");
  });

  it("fades in the columns a longer value adds and never flags a shorter one", () => {
    const { container, rerender } = render(<AnimatedNumber value="430" />);

    rerender(<AnimatedNumber value="1.234" />);
    const newColumns = Array.from(
      container.querySelectorAll<HTMLElement>("[data-column-new]"),
    );
    // Columns past the old length are the ones that did not exist before.
    expect(newColumns).toHaveLength(2);
    expect(
      newColumns.every((node) => node.classList.contains("animated-number-column-in")),
    ).toBe(true);

    rerender(<AnimatedNumber value="12" />);
    expect(container.querySelector("[data-column-new]")).toBeNull();
  });

  it("swaps instantly when the reader asked for reduced motion", () => {
    stubMediaQuery({ [REDUCED_MOTION]: true });

    const { container, rerender } = render(<AnimatedNumber value="$ 100" />);

    rerender(<AnimatedNumber value="$ 250" />);

    const [two] = strips(container);
    expect(two.style.transform).toBe("translateY(-2em)");
    expect(two.style.transitionProperty).toBe("");
    expect(two.style.transitionDuration).toBe("");
    expect(two).not.toHaveAttribute("data-rolling");
    expect(container.querySelector("[data-column-new]")).toBeNull();
    expect(screen.getByText("$ 250")).toHaveClass("sr-only");
  });

  it("sets the columns in tabular figures so they keep their width", () => {
    render(<AnimatedNumber value="$ 12" />);

    expect(screen.getByTestId("animated-number")).toHaveClass("tabular-nums");
  });
});
