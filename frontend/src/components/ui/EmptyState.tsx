import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
}

export function EmptyState({ icon, title, subtitle, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center col-span-full min-h-[200px] text-center",
        className,
      )}
    >
      <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted/40 flex items-center justify-center text-muted-foreground mb-2.5">
        {icon}
      </div>
      <p className="text-xs sm:text-sm font-medium text-foreground mb-0.5">{title}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
