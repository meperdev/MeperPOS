import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface LoadingStateProps {
  icon: ReactNode;
  message: string;
  className?: string;
}

export function LoadingState({ icon, message, className }: LoadingStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center min-h-[200px]", className)}>
      <div className="w-8 h-8 rounded-lg bg-muted/50 border border-border/70 flex items-center justify-center text-muted-foreground animate-pulse">
        {icon}
      </div>
      <p className="text-xs text-muted-foreground mt-2.5">{message}</p>
    </div>
  );
}
