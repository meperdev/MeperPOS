import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

interface ErrorStateProps {
  icon?: ReactNode;
  title?: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  icon = <AlertTriangle className="w-5 h-5" />,
  title,
  message,
  retryLabel,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center min-h-[200px] rounded-xl bg-card border border-border/70 px-6 shadow-2xs",
        className,
      )}
    >
      <div className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-600 dark:text-rose-400">
        {icon}
      </div>
      {title && <p className="text-sm font-semibold text-foreground mt-3">{title}</p>}
      <p className="text-xs text-muted-foreground mt-1">{message}</p>
      {onRetry && retryLabel && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="mt-3.5"
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
