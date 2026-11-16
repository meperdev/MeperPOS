import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

// Press feedback is a colour change, never a scale or a shift.
const buttonVariants = {
  primary:
    "bg-primary text-white border border-primary/80 shadow-2xs hover:bg-primary-dark active:bg-primary-dark",
  secondary:
    "border border-border/70 bg-muted/40 text-foreground hover:border-border hover:bg-muted active:bg-muted",
  danger:
    "bg-danger text-white border border-danger/80 shadow-2xs hover:opacity-90 active:opacity-80",
  ghost:
    "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60 active:bg-muted",
  outline:
    "border border-border/70 bg-card text-foreground shadow-2xs hover:border-border hover:bg-muted/50 active:bg-muted",
  success:
    "bg-success text-white border border-success/80 shadow-2xs hover:opacity-90 active:opacity-80",
};

const buttonSizes = {
  // Phone: every small control is a row/card action under a thumb, so it pays a
  // 44px floor. The density stays desktop-only, which is where it was designed.
  sm: "h-8 px-3 py-1 text-xs font-medium gap-1.5 rounded-md max-sm:min-h-11 max-sm:min-w-11",
  md: "h-10 sm:h-9 px-3.5 py-2 text-xs font-medium gap-2 rounded-lg",
  lg: "h-11 px-5 py-2.5 text-sm font-semibold gap-2 rounded-lg",
};

const BASE_BUTTON_CLASSES = cn(
  "inline-flex items-center justify-center whitespace-nowrap font-medium",
  "transition-colors duration-150",
  // Focus must stay visible: one ring system for every control (D4).
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
);

/**
 * Classes for a button-looking control. Use it on a <Link> when navigation
 * must stay a real link (no button nested in an anchor).
 */
export function buttonClassName({
  variant = "primary",
  size = "md",
  className = "",
}: Pick<ButtonProps, "variant" | "size" | "className"> = {}) {
  return cn(BASE_BUTTON_CLASSES, buttonVariants[variant], buttonSizes[size], className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      children,
      className = "",
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          buttonClassName({ variant, size }),
          // A loading button is busy, not unavailable: keep it legible while it spins.
          loading ? "cursor-wait" : "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin h-4 w-4 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
