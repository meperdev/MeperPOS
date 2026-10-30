import { InputHTMLAttributes, forwardRef, useId, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement> {
  label?: string;
  error?: string;
  textarea?: boolean;
  rows?: number;
  icon?: React.ReactNode;
  prefixText?: string;
  suffixIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement | HTMLTextAreaElement, InputProps>(
  ({ label, error, textarea = false, rows = 3, className = "", icon, prefixText, suffixIcon, required, id, type, disabled, readOnly, ...props }, ref) => {
    const reactId = useId();
    const inputId = id || reactId;
    const innerInputRef = useRef<HTMLInputElement | null>(null);
    const isNumber = !textarea && type === "number";

    const stepNumber = (direction: 1 | -1) => {
      const el = innerInputRef.current;
      if (!el || el.disabled || el.readOnly) return;
      try {
        if (direction === 1) el.stepUp();
        else el.stepDown();
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        nativeSetter?.call(el, el.value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
        // Fallback if stepUp/stepDown is unsupported for current state
      }
    };

    const commonClasses = cn(
      "w-full rounded-lg border bg-card px-3.5 py-2 text-base sm:text-xs text-foreground",
      "placeholder:text-muted-foreground/60",
      "transition-colors duration-150 shadow-2xs",
      "focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/40",
      icon && "pl-9",
      prefixText && "pl-8 font-mono tabular-nums",
      (suffixIcon || isNumber) && "pr-9",
      isNumber &&
        "font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
      error
        ? "border-danger focus:border-danger focus:ring-danger/20"
        : "border-border/70 hover:border-border",
      className,
    );

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            {label}
            {required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
              {icon}
            </span>
          )}
          {prefixText && (
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-xs font-medium text-muted-foreground pointer-events-none">
              {prefixText}
            </span>
          )}
          {textarea ? (
            <textarea
              ref={ref as React.RefObject<HTMLTextAreaElement>}
              id={inputId}
              rows={rows}
              required={required}
              aria-required={required}
              disabled={disabled}
              readOnly={readOnly}
              className={cn(commonClasses, "resize-none")}
              {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          ) : (
            <input
              ref={(node) => {
                innerInputRef.current = node;
                if (typeof ref === "function") ref(node);
                else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
              }}
              id={inputId}
              type={type}
              required={required}
              aria-required={required}
              disabled={disabled}
              readOnly={readOnly}
              className={commonClasses}
              {...props}
            />
          )}
          {suffixIcon && (
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              {suffixIcon}
            </span>
          )}
          {isNumber && !suffixIcon && (
            <div
              aria-hidden="true"
              className={cn(
                "absolute right-1 inset-y-1 flex flex-col w-6 rounded-md border border-border/60 bg-muted/35 overflow-hidden divide-y divide-border/60",
                (disabled || readOnly) && "opacity-40 pointer-events-none",
              )}
            >
              <span
                onClick={() => stepNumber(1)}
                className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors select-none"
              >
                <ChevronUp className="w-3 h-3" />
              </span>
              <span
                onClick={() => stepNumber(-1)}
                className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors select-none"
              >
                <ChevronDown className="w-3 h-3" />
              </span>
            </div>
          )}
        </div>
        {error && (
          <span className="mt-1.5 block text-xs font-medium text-danger">
            {error}
          </span>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
