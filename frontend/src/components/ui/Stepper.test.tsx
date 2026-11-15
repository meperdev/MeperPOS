import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Stepper } from "@/components/ui/Stepper";

describe("Stepper", () => {
  it("renders the decrement/increment buttons and the centered bold value with tabular numerals", () => {
    render(<Stepper value={5} onChange={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Disminuir cantidad" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aumentar cantidad" })
    ).toBeInTheDocument();

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("5");
    expect(input).toHaveAttribute("inputMode", "numeric");
    expect(input).toHaveAccessibleName("Cantidad");
    expect(input.className).toContain("tabular-nums");
    expect(input.className).not.toContain("font-mono");
    expect(input.className).toContain("font-bold");
  });

  it("calls onChange with value + step when the increment button is clicked", () => {
    const onChange = vi.fn();
    render(<Stepper value={3} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Aumentar cantidad" }));

    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("calls onChange with value - step when the decrement button is clicked", () => {
    const onChange = vi.fn();
    render(<Stepper value={3} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Disminuir cantidad" }));

    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("disables the decrement button at the floor (value === min) and does not fire onChange", () => {
    const onChange = vi.fn();
    render(<Stepper value={0} min={0} onChange={onChange} />);

    const decrement = screen.getByRole("button", {
      name: "Disminuir cantidad",
    });
    expect(decrement).toBeDisabled();

    fireEvent.click(decrement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables the increment button when value equals max", () => {
    const onChange = vi.fn();
    render(<Stepper value={10} max={10} onChange={onChange} />);

    const increment = screen.getByRole("button", {
      name: "Aumentar cantidad",
    });
    expect(increment).toBeDisabled();

    fireEvent.click(increment);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clamps a numeric input value to the min/max range when typing", () => {
    const onChange = vi.fn();
    render(<Stepper value={5} min={0} max={10} onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "20" },
    });

    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("fires onChange(min) when the typed value is not a number", () => {
    const onChange = vi.fn();
    render(<Stepper value={5} min={0} onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "abc" },
    });

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("disables the buttons and the input when the disabled prop is set", () => {
    const onChange = vi.fn();
    render(<Stepper value={5} disabled onChange={onChange} />);

    expect(
      screen.getByRole("button", { name: "Disminuir cantidad" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Aumentar cantidad" })
    ).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
