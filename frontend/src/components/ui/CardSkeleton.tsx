import { cn } from "@/lib/utils";

/** One calm pulse shared by every skeleton bar: slower and lower contrast than the default. */
const PULSE = "animate-pulse [animation-duration:2.4s] motion-reduce:animate-none";

/**
 * Loading placeholder shaped like a card grid. Same contract as the table
 * skeleton: the message lives in the accessibility tree as a polite status.
 *
 * `gridClassName` replaces the default responsive grid, so a collection page can
 * paint its skeleton on the exact grid its real cards use.
 */
export function CardSkeleton({
  count = 6,
  label = "Cargando...",
  className,
  cardClassName,
  gridClassName,
}: {
  count?: number;
  label?: string;
  className?: string;
  cardClassName?: string;
  gridClassName?: string;
}) {
  return (
    <div
      role="status"
      className={cn(gridClassName ?? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3", className)}
    >
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
          <div className={cn("h-2.5 w-1/3 rounded-full bg-muted-foreground/12", PULSE)} />
          <div className={cn("mt-3 h-5 w-2/3 rounded-full bg-muted-foreground/12", PULSE)} />
          <div className={cn("mt-3 h-2.5 w-full rounded-full bg-muted-foreground/10", PULSE)} />
          <div className={cn("mt-2 h-2.5 w-4/5 rounded-full bg-muted-foreground/10", PULSE)} />
        </div>
      ))}
    </div>
  );
}
