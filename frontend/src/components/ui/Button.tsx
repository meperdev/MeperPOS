import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
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
    const variants = {
      primary:
        "bg-primary text-white border border-primary/80 shadow-2xs hover:bg-primary-dark",
      secondary:
        "border border-border/70 bg-muted/40 text-foreground hover:border-border hover:bg-muted",
      danger:
        "bg-danger text-white border border-danger/80 shadow-2xs hover:opacity-90",
      ghost:
        "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60",
      outline:
        "border border-border/70 bg-card text-foreground shadow-2xs hover:border-border hover:bg-muted/50",
      success:
        "bg-success text-white border border-success/80 shadow-2xs hover:opacity-90",
    };

    const sizes = {
      sm: "h-7 px-2.5 py-1 text-xs font-medium gap-1.5 rounded-md",
      md: "h-[38px] px-3.5 py-2 text-xs font-medium gap-2 rounded-lg",
      lg: "h-11 px-5 py-2.5 text-sm font-semibold gap-2 rounded-lg",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-medium",
          "transition-[background-color,border-color,color,transform,opacity] duration-150",
          // HIG: every custom button needs a press state, and focus must stay visible.
          "active:translate-y-px active:duration-75",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          // A loading button is busy, not unavailable: keep it legible while it spins.
          loading ? "cursor-wait" : "disabled:cursor-not-allowed disabled:opacity-50",
          variants[variant],
          sizes[size],
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
