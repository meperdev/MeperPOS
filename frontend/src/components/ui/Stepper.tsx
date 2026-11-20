"use client";

import React from "react";
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
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999999,
  step = 1,
  size = "md",
  className = "",
  disabled = false,
}: StepperProps) {
  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || value <= min) return;
    onChange(Math.max(min, value - step));
  };

  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || value >= max) return;
    onChange(Math.min(max, value + step));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  return (
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
        aria-label="Disminuir cantidad"
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
        type="text"
        inputMode="numeric"
        aria-label="Cantidad"
        value={value}
        onChange={handleInputChange}
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
        aria-label="Aumentar cantidad"
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
}
