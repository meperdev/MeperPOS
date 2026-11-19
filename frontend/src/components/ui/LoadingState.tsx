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
      <div className="w-10 h-10 rounded-lg bg-muted/50 border border-border/70 flex items-center justify-center text-muted-foreground animate-pulse [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </div>
      <p className="text-[13px] text-muted-foreground mt-2.5">{message}</p>
    </div>
  );
}
