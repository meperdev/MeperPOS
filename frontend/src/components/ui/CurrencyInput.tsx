"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/Input";
import { toFiniteNumber } from "@/lib/utils";

interface CurrencyInputProps {
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

/**
 * COP currency input that formats thousands with dots as the user types.
 * Displays `1.250.000` live; onChange emits a clean number. Keeps internal
 * display state so typing is instant, and re-syncs when `value` changes
 * externally (e.g. form reset / programmatic set).
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
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
    },
    ref,
  ) => {
    const [display, setDisplay] = useState(() => formatThousands(digitsFromValue(value)));
    const lastValueRef = useRef<number | string | undefined>(value);

    // Re-sync the visible display when `value` changes from OUTSIDE (form reset,
    // programmatic set, parent updates after a submit). We skip re-syncing when
    // the change is just echoing back the same number the user just typed.
    useEffect(() => {
      const before = lastValueRef.current;
      lastValueRef.current = value;
      const nextDigits = digitsFromValue(value);
      const currentDigits = display.replace(/\D/g, "");
      if (String(before) === String(value) || nextDigits === currentDigits) {
        return;
      }
      setDisplay(formatThousands(nextDigits));
    }, [value, display]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const digits = toDigits(e.target.value);
        const numeric = digits ? Number(digits) : 0;
        const clamped = max !== undefined ? Math.min(numeric, max) : numeric;
        setDisplay(formatThousands(String(clamped)));
        if (onChange) onChange(clamped);
      },
      [max, onChange],
    );

    return (
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
        className={className}
        value={display}
        onChange={handleChange}
        onBlur={onBlur}
        autoComplete="off"
      />
    );
  },
);

CurrencyInput.displayName = "CurrencyInput";
