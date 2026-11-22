import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/Input";

describe("Input number stepper", () => {
  it("names each stepper after its field so identical fields stay distinguishable", () => {
    render(
      <>
        <Input label="Cantidad" type="number" defaultValue="1" />
        <Input label="Precio" type="number" defaultValue="1" />
      </>,
    );

    expect(screen.getByRole("button", { name: "Aumentar Cantidad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disminuir Cantidad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aumentar Precio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disminuir Precio" })).toBeInTheDocument();
  });

  it("names the steppers from aria-label when the field is labelled that way", () => {
    render(<Input aria-label="Cantidad de producto" type="number" defaultValue="1" />);

    expect(screen.getByRole("button", { name: "Aumentar Cantidad de producto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disminuir Cantidad de producto" })).toBeInTheDocument();
  });

  it("falls back to generic stepper names when the field has no text label", () => {
    render(<Input type="number" defaultValue="1" />);

    expect(screen.getByRole("button", { name: "Aumentar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disminuir" })).toBeInTheDocument();
  });

  it("preserves right stepper clearance even when caller overrides horizontal padding", () => {
    render(<Input aria-label="Cantidad" type="number" className="px-2 text-right" defaultValue="1" />);

    const input = screen.getByRole("spinbutton", { name: "Cantidad" });
    expect(input.className).toContain("pr-9");
  });

  it("omits the stepper overlay and reserved right padding when hideStepper is set", () => {
    render(<Input aria-label="Cantidad" type="number" hideStepper defaultValue="1" />);

    const input = screen.getByRole("spinbutton", { name: "Cantidad" });
    expect(screen.queryByRole("button", { name: /Aumentar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Disminuir/ })).toBeNull();
    expect(input.className).not.toContain("pr-9");
  });
});

describe("Input mobile keyboard hints", () => {
  it("forwards the hints a phone keyboard needs", () => {
    render(
      <Input
        label="Correo electrónico"
        type="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
      />,
    );

    const field = screen.getByLabelText("Correo electrónico");
    expect(field).toHaveAttribute("autocapitalize", "none");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
    expect(field).toHaveAttribute("enterkeyhint", "next");
  });
});

describe("Input autofocus follows the pointer (no automatic keyboard)", () => {
  afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

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

  it("focuses the field on a fine pointer, where a scanner expects it", () => {
    stubMediaQuery({});

    render(<Input label="Correo" autoFocus />);

    expect(screen.getByLabelText("Correo")).toHaveFocus();
  });

  it("does not raise the keyboard on a touch device", () => {
    stubMediaQuery({ "(pointer: coarse)": true });

    render(<Input label="Correo" autoFocus />);

    expect(screen.getByLabelText("Correo")).not.toHaveFocus();
  });

  it("applies the same rule to a textarea", () => {
    stubMediaQuery({ "(pointer: coarse)": true });

    render(<Input textarea label="Notas" autoFocus />);

    expect(screen.getByLabelText("Notas")).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});
