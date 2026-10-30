import { cn } from "@/lib/utils";
import { chipStyles } from "@/lib/chipStyles";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "primary" | "secondary";
  dot?: boolean;
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

export function Badge({ children, variant = "default", dot = false, className = "" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium tracking-tight",
        variants[variant],
        className,
      )}
    >
      {dot && (
        <span
          className={cn("w-1.5 h-1.5 rounded-full mr-1.5 shrink-0", dotColors[variant])}
        />
      )}
      {children}
    </span>
  );
}
