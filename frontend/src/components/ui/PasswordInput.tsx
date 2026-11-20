"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

/**
 * Client-side strength guidance for a password being created.
 *
 * Length and character classes only, no dictionary and no dependency: a
 * light signal that rewards length (the backend's real minimum is 10) and
 * variety. It is advisory, so it never touches the form's validation.
 */
const STRENGTH_LEVELS = [
  { label: "Débil", fill: "bg-danger", text: "text-danger-text" },
  { label: "Aceptable", fill: "bg-warning", text: "text-warning-text" },
  { label: "Buena", fill: "bg-primary", text: "text-primary-text" },
  { label: "Fuerte", fill: "bg-success", text: "text-success-text" },
] as const;

const STRENGTH_SEGMENTS = STRENGTH_LEVELS.length;

export function passwordStrength(value: string): number {
  if (!value) return 0;

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) =>
    rule.test(value),
  ).length;

  let level = 0;
  if (value.length >= 6) level = 1;
  if (value.length >= 10) level = 2;
  if (value.length >= 14) level = 3;
  if (classes >= 3) level += 1;
  if (classes >= 4) level += 1;

  // Once something is typed the meter always reads at least "Débil", so the
  // advice never looks broken.
  return Math.min(STRENGTH_SEGMENTS, Math.max(1, level));
}

interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  /** Add the advisory strength meter under the field (password creation only). */
  showStrength?: boolean;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { label, error, icon, showStrength = false, className = "", value, onChange, disabled, ...props },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    // The caret is read before the field swaps type and re-applied after,
    // because browsers move it to the end on a type change.
    const caretRef = useRef<number | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [text, setText] = useState(typeof value === "string" ? value : "");

    useEffect(() => {
      if (typeof value === "string") setText(value);
    }, [value]);

    useEffect(() => {
      const field = inputRef.current;
      if (!field || caretRef.current === null) return;
      const caret = caretRef.current;
      caretRef.current = null;
      try {
        field.setSelectionRange(caret, caret);
      } catch {
        // Some browsers refuse a selection range on a password field; the
        // focus that matters is already back on the field.
      }
    }, [revealed]);

    const toggleVisibility = () => {
      const field = inputRef.current;
      caretRef.current =
        field && typeof field.selectionStart === "number"
          ? field.selectionStart
          : null;
      setRevealed((current) => !current);
      field?.focus();
    };

    const setRefs = (node: HTMLInputElement | HTMLTextAreaElement | null) => {
      const field = node as HTMLInputElement | null;
      inputRef.current = field;
      if (typeof ref === "function") ref(field);
      else if (ref) ref.current = field;
    };

    const level = showStrength ? passwordStrength(text) : 0;
    const strength = level > 0 ? STRENGTH_LEVELS[level - 1] : null;

    return (
      <div className="w-full">
        <Input
          {...props}
          ref={setRefs}
          label={label}
          error={error}
          icon={icon}
          disabled={disabled}
          value={value}
          type={revealed ? "text" : "password"}
          // Keeps the text clear of the 32px toggle at the field's right edge.
          className={cn("pr-12", className)}
          onChange={(event) => {
            setText((event.target as HTMLInputElement).value);
            onChange?.(event as React.ChangeEvent<HTMLInputElement>);
          }}
          suffixIcon={
            <button
              type="button"
              disabled={disabled}
              aria-label={revealed ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={revealed}
              title={revealed ? "Ocultar contraseña" : "Mostrar contraseña"}
              // Pointer presses keep the caret where it is; the field below
              // still takes the focus back after the swap.
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleVisibility}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {revealed ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          }
        />

        {showStrength && (
          <div className="mt-2.5">
            <div className="flex gap-1" aria-hidden="true">
              {Array.from({ length: STRENGTH_SEGMENTS }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-150",
                    strength && index < level ? strength.fill : "bg-muted-foreground/30",
                  )}
                />
              ))}
            </div>
            <p
              aria-live="polite"
              className={cn(
                "mt-1 min-h-4 text-[12px] font-medium leading-4",
                strength ? strength.text : "text-muted-foreground",
              )}
            >
              {strength?.label ?? ""}
            </p>
          </div>
        )}
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
