import { cn, formatCurrency } from "@/lib/utils";
import type { ExpenseMonthlySummary } from "@/types";

interface Props {
  month?: string;
  summary?: ExpenseMonthlySummary;
}

/**
 * Track count for the cells that exist, so a strip of three categories never
 * paints a fourth, empty segment. Every number here comes from the summary
 * endpoint; the page adds no money of its own.
 */
const STRIP_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3",
};
const STRIP_FALLBACK_COLUMNS = "grid-cols-2 sm:grid-cols-4";

/** One segment: label, amount and the quiet detail that explains it. */
const CELL_CLASSES =
  "border-b border-r border-border/60 bg-card px-3 py-3";

/**
 * The label and the detail lines read as text at 13px; the month total is the
 * one figure the cell is scanned for, so it sits a step above the group totals.
 */
const CELL_LABEL_CLASSES = "text-[13px] text-muted-foreground";
const CELL_DETAIL_CLASSES = "mt-2 space-y-1 text-[13px] text-muted-foreground";

export function ExpenseSummaryCards({ month, summary }: Props) {
  const groups = summary?.groups ?? [];
  const cells = 1 + groups.length;
  const columns = STRIP_COLUMNS[cells] ?? STRIP_FALLBACK_COLUMNS;

  return (
    <section
      aria-label="Resumen del mes"
      className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs"
    >
      {/*
        Segments of one surface, not cards: the hairlines are each cell's own
        right and bottom edge, pulled one pixel past the card so `overflow-hidden`
        trims them into the outer border, and the card's surface fills the last
        row when the category count does not fill it.
      */}
      <div className={cn("-mb-px -mr-px grid", columns)}>
        <div className={CELL_CLASSES}>
          <p className={CELL_LABEL_CLASSES}>Total del mes</p>
          <p className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground tabular-nums">
            {formatCurrency(Number(summary?.total ?? 0))}
          </p>
          <div className={CELL_DETAIL_CLASSES}>
            <p className="truncate tabular-nums">Período: {month ?? "—"}</p>
            <p className="tabular-nums">
              {groups.length} {groups.length === 1 ? "grupo" : "grupos"}
            </p>
          </div>
        </div>

        {groups.map((group) => {
          const labels = (group.labels ?? []).slice(0, 2);
          return (
            <div key={group.groupId} className={CELL_CLASSES}>
              <p className={cn("truncate", CELL_LABEL_CLASSES)}>
                {group.name}
              </p>
              <p className="mt-1 truncate text-lg font-semibold tracking-tight text-foreground tabular-nums">
                {formatCurrency(Number(group.total ?? 0))}
              </p>
              <div className={CELL_DETAIL_CLASSES}>
                {labels.length === 0 ? (
                  <p className="truncate">Sin etiquetas</p>
                ) : (
                  labels.map((label) => (
                    <div
                      key={label.labelId}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{label.name}</span>
                      <span className="shrink-0 font-medium text-foreground/80 tabular-nums">
                        {formatCurrency(Number(label.total ?? 0))}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
