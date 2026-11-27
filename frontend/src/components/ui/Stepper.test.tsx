import { useState } from "react";
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

  it("names the field, its buttons and its visible label after the label prop", () => {
    const onChange = vi.fn();
    render(<Stepper label="Stock mín." value={2} onChange={onChange} />);

    const input = screen.getByLabelText("Stock mín.");
    expect(input).toHaveValue("2");
    expect(screen.getByText("Stock mín.").tagName).toBe("LABEL");
    expect(screen.queryByLabelText("Cantidad")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aumentar Stock mín." }));
    expect(onChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Disminuir Stock mín." }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  function Controlled({ initial, min, onCommit }: { initial: number; min: number; onCommit?: (v: number) => void }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <Stepper value={value} min={min} onChange={(v) => { setValue(v); onCommit?.(v); }} />
        <button type="button" onClick={() => setValue((v) => v + 1)}>external</button>
      </>
    );
  }

  it("commits min on clearing but lets the field be retyped instead of reading 17", () => {
    const onCommit = vi.fn();
    render(<Controlled initial={5} min={1} onCommit={onCommit} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "" } });
    // The value in use is min at once; only the display stays blank.
    expect(onCommit).toHaveBeenLastCalledWith(1);
    expect(input).toHaveValue("");

    fireEvent.change(input, { target: { value: "7" } });
    expect(onCommit).toHaveBeenLastCalledWith(7);
    expect(input).toHaveValue("7");
  });

  it("shows an outside change made while the field is blank, and the number again on blur", () => {
    render(<Controlled initial={5} min={1} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "external" }));
    expect(input).toHaveValue("2");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("1");
  });

  it("can keep its label for assistive tech only and forward data attributes", () => {
    render(
      <Stepper
        label="Cantidad de Panela"
        hideLabel
        value={2}
        onChange={vi.fn()}
        inputProps={{ "data-qty-row": "row-1" }}
      />,
    );

    const input = screen.getByLabelText("Cantidad de Panela");
    expect(input).toHaveAttribute("data-qty-row", "row-1");
    expect(screen.getByText("Cantidad de Panela")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "Aumentar Cantidad de Panela" })).toBeInTheDocument();
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
