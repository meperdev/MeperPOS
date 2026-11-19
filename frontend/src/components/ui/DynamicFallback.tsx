import { cn } from "@/lib/utils";

interface DynamicFallbackProps {
  /** Shown under the spinner while the lazily loaded chunk arrives. */
  label?: string;
  className?: string;
}

/**
 * Shared loading fallback for next/dynamic imports. Rendered in place of a
 * lazily loaded modal/drawer chunk while it is fetched (S1 code splitting).
 */
export function DynamicFallback({ label = "Cargando...", className }: DynamicFallbackProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="dynamic-fallback"
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 py-12",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-b-transparent"
      />
      <span className="text-[13px] text-muted-foreground">{label}</span>
    </div>
  );
}
