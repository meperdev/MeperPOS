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
      container: "p-0.5 rounded-lg text-xs",
      btn: "w-6 h-6 rounded-md text-xs",
      input: "w-8 text-xs",
    },
    md: {
      container: "p-1 rounded-xl text-sm",
      btn: "w-8 h-8 rounded-lg text-sm",
      input: "w-12 text-sm",
    },
    lg: {
      container: "p-1.5 rounded-2xl text-base",
      btn: "w-10 h-10 rounded-xl text-base",
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
          "hover:bg-primary-light hover:text-primary-text active:scale-90 transition-all duration-150 shadow-xs",
          "disabled:opacity-40 disabled:pointer-events-none",
          currentSize.btn
        )}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleInputChange}
        disabled={disabled}
        className={cn(
          "text-center font-mono font-bold bg-transparent text-foreground focus:outline-none",
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
          "hover:bg-primary-light hover:text-primary-text active:scale-90 transition-all duration-150 shadow-xs",
          "disabled:opacity-40 disabled:pointer-events-none",
          currentSize.btn
        )}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
