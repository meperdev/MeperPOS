import { cn } from "@/lib/utils";

/**
 * Loading placeholder shaped like a card grid. Same contract as the table
 * skeleton: the message lives in the accessibility tree as a polite status.
 */
export function CardSkeleton({
  count = 6,
  label = "Cargando...",
  className,
  cardClassName,
}: {
  count?: number;
  label?: string;
  className?: string;
  cardClassName?: string;
}) {
  return (
    <div role="status" className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "rounded-xl border border-border/70 bg-card p-4",
            cardClassName,
          )}
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <div className="h-2.5 w-1/3 animate-pulse rounded-full bg-muted-foreground/20" />
          <div className="mt-3 h-5 w-2/3 animate-pulse rounded-full bg-muted-foreground/20" />
          <div className="mt-3 h-2.5 w-full animate-pulse rounded-full bg-muted-foreground/15" />
          <div className="mt-2 h-2.5 w-4/5 animate-pulse rounded-full bg-muted-foreground/15" />
        </div>
      ))}
    </div>
  );
}
