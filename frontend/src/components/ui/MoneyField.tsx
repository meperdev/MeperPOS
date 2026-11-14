"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";

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
 * Money input that groups thousands as you type and keeps the raw decimal
 * string for the request. Dots are separators, comma opens the decimals.
 */
export function MoneyField({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  helper,
}: {
  label: string;
  value: string;
  onChange: (raw: string) => void;
  required?: boolean;
  disabled?: boolean;
  helper?: string;
}) {
  const [display, setDisplay] = useState(() => formatMoney(value));
  const [focused, setFocused] = useState(false);
  const [previousRaw, setPreviousRaw] = useState(value);

  const shown = focused ? display : formatMoney(value);

  return (
    <div>
      <Input
        label={label}
        required={required}
        disabled={disabled}
        inputMode="decimal"
        autoComplete="off"
        className="font-mono tabular-nums"
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
      {helper && (
        <p className="mt-1.5 text-xs text-muted-foreground">{helper}</p>
      )}
    </div>
  );
}
