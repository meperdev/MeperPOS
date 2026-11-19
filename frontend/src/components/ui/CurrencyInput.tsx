"use client";

import { forwardRef, useCallback, useState } from "react";
import { Input } from "@/components/ui/Input";
import { cn, toFiniteNumber } from "@/lib/utils";

interface CurrencyInputCommonProps {
  /** Text rendered under the field, in either mode. */
  helper?: string;
}

/** COP mode: integer pesos, `1.250.000`, a number comes out. */
export interface IntegerCurrencyInputProps extends CurrencyInputCommonProps {
  decimals?: false;
  label?: string;
  value?: number | string;
  onChange?: (value: number) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  prefixText?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  max?: number;
}

/** Decimal mode: the raw decimal string the server accepts, `1.250.000,75`. */
export interface DecimalCurrencyInputProps extends CurrencyInputCommonProps {
  decimals: true;
  label: string;
  value: string;
  onChange: (raw: string) => void;
  required?: boolean;
  disabled?: boolean;
}

export type CurrencyInputProps =
  | IntegerCurrencyInputProps
  | DecimalCurrencyInputProps;

/** Strips any non-digit characters and leading zeros. */
function toDigits(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/** Adds `.` thousands separators: `1250000` -> `1.250.000`. */
function formatThousands(digits: string): string {
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function digitsFromValue(v: number | string | undefined): string {
  if (v === undefined || v === null) return "";
  // Resolve the value to a number BEFORE stripping digits. A Prisma `Decimal`
  // arrives as a string ("15000.00"); digit-stripping that directly yields
  // "1500000" and displays 100x the real amount. A blank input stays blank
  // instead of collapsing to a displayed "0".
  if (typeof v === "string" && v.trim() === "") return "";
  const numeric = toFiniteNumber(v);
  // A zero is "nothing typed yet" in a money field; leaving it on screen makes
  // the caret fight the digit and reads like a value the user chose.
  if (numeric === 0) return "";
  return toDigits(String(numeric));
}

/** `1500000.75` -> `1.500.000,75`; empty stays empty. */
function formatMoney(raw: string) {
  if (!raw) return "";
  const [integer = "", decimals] = raw.split(".");
  const grouped = integer
    .replace(/^0+(?=\d)/, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals !== undefined ? `${grouped || "0"},${decimals}` : grouped;
}

/**
 * Turns what the user sees back into the decimal string the server accepts.
 *
 * The display groups thousands with `.` and opens decimals with `,`; a typed
 * `.` becomes the decimal point only when it is trailing or when decimals are
 * already open. That keeps "1.500" backspaced to "1.50" at 150 instead of 1,5 —
 * the reason plain number fields felt uneditable.
 */
function parseMoney(text: string, previousRaw: string) {
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!cleaned) return "";

  const lastSeparator = Math.max(
    cleaned.lastIndexOf("."),
    cleaned.lastIndexOf(","),
  );
  if (lastSeparator === -1) return cleaned.replace(/^0+(?=\d)/, "");

  const separator = cleaned[lastSeparator];
  const decimals = cleaned.slice(lastSeparator + 1).replace(/\D/g, "");
  const integer = cleaned.slice(0, lastSeparator).replace(/[.,]/g, "");
  const decimal =
    lastSeparator === cleaned.length - 1 ||
    separator === "," ||
    (previousRaw.includes(".") && decimals.length <= 2);

  if (!decimal) {
    return cleaned.replace(/[.,]/g, "").replace(/^0+(?=\d)/, "");
  }
  return `${integer.replace(/^0+(?=\d)/, "") || "0"}${decimals ? `.${decimals.slice(0, 2)}` : "."}`;
}

/**
 * Integer COP field: formats thousands with dots as the user types, displays
 * `1.250.000` live and emits a clean number. Keeps internal display state so
 * typing is instant, and re-syncs when `value` changes externally (e.g. form
 * reset / programmatic set).
 */
const IntegerCurrencyInput = forwardRef<
  HTMLInputElement,
  IntegerCurrencyInputProps
>(function IntegerCurrencyInput(
  {
    label,
    value,
    onChange,
    onBlur,
    prefixText = "$",
    error,
    required,
    placeholder,
    disabled,
    className,
    id,
    name,
    max,
    helper,
  },
  ref,
) {
  const [display, setDisplay] = useState(() => formatThousands(digitsFromValue(value)));
  const [lastValue, setLastValue] = useState(value);

  // Adjust the visible display during render when the value changes from
  // OUTSIDE (form reset, programmatic set). No effect pass, no cascading
  // render, and typing is left alone because the digits already match.
  if (String(lastValue) !== String(value)) {
    setLastValue(value);
    const nextDigits = digitsFromValue(value);
    if (nextDigits !== display.replace(/\D/g, "")) {
      setDisplay(formatThousands(nextDigits));
    }
  }

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const digits = toDigits(e.target.value);
      const numeric = digits ? Number(digits) : 0;
      const clamped = max !== undefined ? Math.min(numeric, max) : numeric;
      // An empty field stays empty: it is "nothing typed yet", not a zero.
      setDisplay(digits ? formatThousands(String(clamped)) : "");
      if (onChange) onChange(clamped);
    },
    [max, onChange],
  );

  const field = (
    <Input
      ref={ref}
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      label={label}
      prefixText={prefixText}
      error={error}
      required={required}
      placeholder={placeholder}
      disabled={disabled}
      className={cn("tabular-nums", className)}
      value={display}
      onChange={handleChange}
      onBlur={onBlur}
      autoComplete="off"
    />
  );

  if (!helper) return field;
  return <HelperText text={helper}>{field}</HelperText>;
});

/**
 * Decimal field: groups thousands as you type and keeps the raw decimal string
 * for the request. Dots are separators, comma opens the decimals (max 2).
 */
function DecimalCurrencyInput({
  label,
  value,
  onChange,
  helper,
  required = false,
  disabled = false,
}: DecimalCurrencyInputProps) {
  const [display, setDisplay] = useState(() => formatMoney(value));
  const [focused, setFocused] = useState(false);
  const [previousRaw, setPreviousRaw] = useState(value);

  const shown = focused ? display : formatMoney(value);

  return (
    <HelperText text={helper}>
      <Input
        label={label}
        required={required}
        disabled={disabled}
        inputMode="decimal"
        autoComplete="off"
        className="tabular-nums"
        value={shown}
        onFocus={() => {
          setPreviousRaw(value);
          setDisplay(formatMoney(value));
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setDisplay(formatMoney(value));
        }}
        onChange={(event) => {
          const raw = parseMoney(event.target.value, previousRaw);
          setPreviousRaw(raw);
          setDisplay(formatMoney(raw));
          onChange(raw);
        }}
      />
    </HelperText>
  );
}

function HelperText({
  text,
  children,
}: {
  text?: string;
  children: React.ReactNode;
}) {
  if (!text) return <>{children}</>;
  return (
    <div>
      {children}
      <p className="mt-1.5 text-[13px] text-muted-foreground">{text}</p>
    </div>
  );
}

/**
 * One money field, two modes. Integer COP (default) emits a number and adds the
 * `$` prefix; `decimals` emits the raw decimal string the request accepts and
 * has no currency prefix.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(props, ref) {
    if (props.decimals === true) {
      return <DecimalCurrencyInput {...props} />;
    }
    return <IntegerCurrencyInput {...props} ref={ref} />;
  },
);

CurrencyInput.displayName = "CurrencyInput";
