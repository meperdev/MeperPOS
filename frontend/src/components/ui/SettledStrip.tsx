import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettledStripProps {
  /** Sentence-case verdict the card reached: "Pagado completo", "Saldado"… */
  label: string;
  /** Already formatted day; a card without one states the verdict alone. */
  date?: string | null;
  testId?: string;
  className?: string;
}

/**
 * The settled state of a paid-so-far block, shared by the expense, loan,
 * payroll and purchase-order cards.
 *
 * A page of completed records used to read as a column of full green bars; this
 * strip replaces the bar with one quiet line whose verdict sits at the leading
 * edge and whose day sits at the trailing one, so a card whose description runs
 * long does not make it look like an extra line of that description. It keeps
 * the block's exact height (`h-7`: the 6px bar, its 6px gap and the 16px
 * caption), so settled and pending cards in one grid row stay aligned.
 *
 * Only the dot carries colour, and only on the check inside it.
 */
export function SettledStrip({
  label,
  date,
  testId,
  className,
}: SettledStripProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success/15 text-success-text"
      >
        <Check className="h-3 w-3" />
      </span>
      <span className="truncate text-xs font-medium text-foreground/80">
        {label}
      </span>
      {date && (
        // A date reads as text, so it keeps proportional figures.
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {date}
        </span>
      )}
    </div>
  );
}
