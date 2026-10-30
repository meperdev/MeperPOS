import { cn } from "@/lib/utils";

/**
 * Loading placeholder shaped like the data table that replaces it, so the
 * layout does not jump from a spinner to a full grid. The message stays in the
 * accessibility tree as the polite status announcement.
 */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  label = "Cargando...",
  className,
}: {
  rows?: number;
  columns?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-card",
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-4 border-b border-border/60 bg-muted/30 px-4 py-3">
        {Array.from({ length: columns }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "h-2.5 rounded-full bg-muted-foreground/15",
              index === 0 ? "w-24" : index === columns - 1 ? "w-16" : "w-20",
            )}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="flex items-center gap-4 border-b border-border/40 px-4 py-3 last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, column) => (
            <div
              key={column}
              className={cn(
                "h-3 animate-pulse rounded-full bg-muted-foreground/20",
                column === 0
                  ? "w-28"
                  : column === columns - 1
                    ? "w-14"
                    : "w-20",
              )}
              style={{ animationDelay: `${row * 60}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
