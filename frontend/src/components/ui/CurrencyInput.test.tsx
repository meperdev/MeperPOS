import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CurrencyInput } from "@/components/ui/CurrencyInput";

/** Realistic wrapper: parent owns the number state and echoes onChange. */
function Harness({ initial = 0, max }: { initial?: number; max?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <CurrencyInput
      label="Precio"
      value={value}
      max={max}
      onChange={(v) => setValue(v)}
    />
  );
}

describe("CurrencyInput", () => {
  it("formats thousands with dots as the user types", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "1250" } });
    expect(input).toHaveValue("1.250");

    fireEvent.change(input, { target: { value: "1250000" } });
    expect(input).toHaveValue("1.250.000");
  });

  it("renders a formatted value when mounted with a number", () => {
    render(<Harness initial={185000} />);
    expect(screen.getByRole("textbox")).toHaveValue("185.000");
  });

  it("ignores non-digit characters and formats digits", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1a2b3c4" } });
    expect(input).toHaveValue("1.234");
  });

  it("shows empty when value is 0", () => {
    render(<Harness initial={0} />);
    // Zero is "nothing typed yet": the field must not put a digit in front of
    // the caret.
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("clamps to max when max is provided", () => {
    const onChange = vi.fn();
    render(<CurrencyInput value={1000} onChange={onChange} max={100000} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "500000" } });
    expect(onChange).toHaveBeenLastCalledWith(100000);
  });

  it("renders a Prisma Decimal string without inflating the fraction", () => {
    render(<CurrencyInput value="15000.00" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("15.000");
  });

  it("stays empty for a blank value instead of displaying 0", () => {
    render(<CurrencyInput value="   " onChange={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
