"use client";

import React, { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Minus, Plus } from "lucide-react";

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
  /**
   * The field's name. When set it renders as a visible label and names the
   * value and both buttons ("Aumentar Stock"); without it the control keeps
   * the POS wording ("Cantidad", "Aumentar cantidad").
   */
  label?: string;
  /** Keeps `label` for assistive tech only, e.g. inside a table cell. */
  hideLabel?: boolean;
  id?: string;
  /** Data attributes for the value field (focus targets, test hooks). */
  inputProps?: { [key: `data-${string}`]: string };
}

/**
 * The one counter control: minus, the whole-number value, plus. Every integer
 * counter in the app (cart quantity, stock, received or ordered units) uses it;
 * decimal values (tax rates, percentages) and money are not counters.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999999,
  step = 1,
  size = "md",
  className = "",
  disabled = false,
  label,
  hideLabel = false,
  id,
  inputProps,
}: StepperProps) {
  const reactId = useId();
  const inputId = id || reactId;
  const decrementLabel = label ? `Disminuir ${label}` : "Disminuir cantidad";
  const incrementLabel = label ? `Aumentar ${label}` : "Aumentar cantidad";
  // Emptying the field commits `min` at once, as it always did, so a cart or a
  // form never holds a value the reader cannot see being used. Only the display
  // stays empty, so "clear, type 7" reads 7 instead of 17. The blank lasts while
  // the value is still the one committed on clearing: any change from outside
  // (a scan, a button) shows through, and leaving the field restores the number.
  const [emptiedAt, setEmptiedAt] = useState<number | null>(null);
  const showsBlank = emptiedAt !== null && emptiedAt === value;

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || value <= min) return;
    setEmptiedAt(null);
    onChange(Math.max(min, value - step));
  };

  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || value >= max) return;
    setEmptiedAt(null);
    onChange(Math.min(max, value + step));
  };

  const handleBlur = () => {
    setEmptiedAt(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value.trim() === "") {
      setEmptiedAt(min);
      onChange(min);
      return;
    }
    setEmptiedAt(null);
    const rawVal = parseInt(e.target.value, 10);
    if (isNaN(rawVal)) {
      onChange(min);
    } else {
      onChange(Math.min(max, Math.max(min, rawVal)));
    }
  };

  const sizes = {
    sm: {
      container: "p-0.5 rounded-lg text-[13px]",
      btn: "w-8 h-8 rounded-md text-[13px]",
      input: "w-10 text-[13px]",
    },
    md: {
      container: "p-1 rounded-xl text-sm",
      btn: "w-10 h-10 rounded-lg text-sm",
      input: "w-12 text-sm",
    },
    lg: {
      container: "p-1.5 rounded-2xl text-base",
      btn: "w-11 h-11 rounded-xl text-base",
      input: "w-16 text-base font-bold",
    },
  };

  const currentSize = sizes[size];

  const control = (
    <div
      className={cn(
        "inline-flex items-center bg-muted/60 border border-border/80 shadow-inner",
        currentSize.container,
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <button
        type="button"
        onClick={handleDecrement}
        disabled={disabled || value <= min}
        aria-label={decrementLabel}
        className={cn(
          "bg-card border border-border/60 text-foreground flex items-center justify-center font-bold",
          "hover:bg-primary-light hover:text-primary-text active:bg-muted transition-colors duration-150 shadow-xs",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "disabled:opacity-40 disabled:pointer-events-none",
          currentSize.btn
        )}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        aria-label={label ? undefined : "Cantidad"}
        {...inputProps}
        value={showsBlank ? "" : value}
        onChange={handleInputChange}
        onBlur={handleBlur}
        disabled={disabled}
        className={cn(
          "rounded-md text-center font-bold tabular-nums bg-transparent text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary/25",
          currentSize.input
        )}
      />

      <button
        type="button"
        onClick={handleIncrement}
        disabled={disabled || value >= max}
        aria-label={incrementLabel}
        className={cn(
          "bg-card border border-border/60 text-foreground flex items-center justify-center font-bold",
          "hover:bg-primary-light hover:text-primary-text active:bg-muted transition-colors duration-150 shadow-xs",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "disabled:opacity-40 disabled:pointer-events-none",
          currentSize.btn
        )}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  if (!label) return control;

  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        className={
          hideLabel
            ? "sr-only"
            : "mb-1.5 block text-[13px] font-medium text-muted-foreground"
        }
      >
        {label}
      </label>
      {control}
    </div>
  );
}
