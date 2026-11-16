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

  it("keeps integer mode helper-less and still emits a number", () => {
    const onChange = vi.fn();
    const { container } = render(<CurrencyInput value={1000} onChange={onChange} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "2500" } });

    expect(onChange).toHaveBeenLastCalledWith(2500);
    expect(typeof onChange.mock.lastCall?.[0]).toBe("number");
    expect(input.className).toContain("tabular-nums");
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});

/** Decimal mode owns the raw decimal string the route accepts. */
function DecimalHarness({
  initial = "",
  helper,
  onChange,
}: {
  initial?: string;
  helper?: string;
  onChange?: (raw: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CurrencyInput
      decimals
      label="Valor"
      value={value}
      onChange={(raw) => {
        onChange?.(raw);
        setValue(raw);
      }}
      helper={helper}
    />
  );
}

describe("CurrencyInput decimals mode", () => {
  it("groups thousands with dots and opens the decimals with a comma", () => {
    render(<DecimalHarness initial="1500000.75" />);
    const input = screen.getByRole("textbox");

    expect(input).toHaveValue("1.500.000,75");
    expect(input.className).toContain("tabular-nums");
    // Decimal mode has no currency prefix.
    expect(input.parentElement?.textContent).not.toContain("$");
  });

  it("opens the decimals on a typed comma and caps them at two", () => {
    const onChange = vi.fn();
    render(<DecimalHarness onChange={onChange} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "1500," } });
    expect(input).toHaveValue("1.500,");
    expect(onChange).toHaveBeenLastCalledWith("1500.");

    fireEvent.change(input, { target: { value: "1500,75" } });
    expect(input).toHaveValue("1.500,75");
    expect(onChange).toHaveBeenLastCalledWith("1500.75");

    fireEvent.change(input, { target: { value: "1500,756" } });
    expect(input).toHaveValue("1.500,75");
    expect(onChange).toHaveBeenLastCalledWith("1500.75");
  });

  it("keeps a dot as the thousands separator when backspacing 1.500 to 1.50", () => {
    const onChange = vi.fn();
    render(<DecimalHarness initial="1500" onChange={onChange} />);
    const input = screen.getByRole("textbox");

    expect(input).toHaveValue("1.500");
    fireEvent.change(input, { target: { value: "1.50" } });
    // 150 pesos, not 1,5: the dot only becomes a decimal point while the
    // decimals are already open (the rule that made this field editable).
    expect(onChange).toHaveBeenLastCalledWith("150");
    expect(input).toHaveValue("150");

    // With the decimals open, "1.5" is the raw itself and must survive.
    fireEvent.change(input, { target: { value: "1," } });
    expect(onChange).toHaveBeenLastCalledWith("1.");
    fireEvent.change(input, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenLastCalledWith("1.5");
  });

  it("ignores non-numeric characters", () => {
    const onChange = vi.fn();
    render(<DecimalHarness onChange={onChange} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "1a2b3c" } });
    expect(onChange).toHaveBeenLastCalledWith("123");
    expect(input).toHaveValue("123");
  });

  it("stays empty when the value is empty", () => {
    const onChange = vi.fn();
    render(<DecimalHarness initial="1500" onChange={onChange} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(input).toHaveValue("");
  });

  it("emits the raw decimal string, never a number", () => {
    const onChange = vi.fn();
    render(<DecimalHarness initial="1500.75" onChange={onChange} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "1500,5" } });
    expect(onChange).toHaveBeenLastCalledWith("1500.5");
    expect(typeof onChange.mock.lastCall?.[0]).toBe("string");
  });

  it("renders helper text below the field in both modes", () => {
    const helper = "Es la base que se propone al crear un pago.";
    const decimal = render(<DecimalHarness helper={helper} />);
    const decimalInput = screen.getByRole("textbox");
    const decimalHelper = screen.getByText(helper);
    expect(decimalHelper.tagName).toBe("P");
    expect(decimalHelper.className).toContain("text-muted-foreground");
    expect(
      decimalInput.compareDocumentPosition(decimalHelper) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    decimal.unmount();

    const integer = render(
      <CurrencyInput label="Precio" value={1000} onChange={vi.fn()} helper={helper} />,
    );
    const integerInput = screen.getByRole("textbox");
    const integerHelper = screen.getByText(helper);
    expect(integerHelper.tagName).toBe("P");
    expect(integerHelper.className).toContain("text-muted-foreground");
    expect(
      integerInput.compareDocumentPosition(integerHelper) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    integer.unmount();
  });
});
