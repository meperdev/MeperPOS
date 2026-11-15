import { cn } from "@/lib/utils";
import { chipStyles } from "@/lib/chipStyles";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "primary" | "secondary" | "info";
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
  info: chipStyles.info,
};

const dotColors = {
  default: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  primary: "bg-primary",
  secondary: "bg-muted-foreground",
  info: "bg-info",
};

export function Badge({ children, variant = "default", dot = false, pulse = false, className = "" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap px-2 py-0.5 rounded-md text-xs font-medium",
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
