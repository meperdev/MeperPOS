import { cn } from "@/lib/utils";
import { chipStyles } from "@/lib/chipStyles";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "primary" | "secondary";
  dot?: boolean;
  /** Pulses the dot: a state that is still settling, not a settled verdict. */
  pulse?: boolean;
  className?: string;
}

const variants: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: chipStyles.neutral,
  success: chipStyles.success,
  warning: chipStyles.warning,
  danger: chipStyles.danger,
  primary: chipStyles.primary,
  secondary: chipStyles.secondary,
};

const dotColors = {
  default: "bg-slate-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  primary: "bg-primary",
  secondary: "bg-stone-500",
};

export function Badge({ children, variant = "default", dot = false, pulse = false, className = "" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium tracking-tight",
        variants[variant],
        className,
      )}
    >
      {dot && (
        <span className="relative mr-1.5 flex h-1.5 w-1.5 shrink-0">
          {pulse && (
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-70",
                dotColors[variant],
              )}
            />
          )}
          <span
            className={cn(
              "relative inline-flex h-1.5 w-1.5 rounded-full",
              dotColors[variant],
            )}
          />
        </span>
      )}
      {children}
    </span>
  );
}
