import { CATEGORY_CHART_PALETTE } from "@/lib/dashboard";
import { LOCALE } from "@/lib/constants";
import { cn, formatCurrency, toFiniteNumber } from "@/lib/utils";
import type { ExpenseMonthlySummary } from "@/types";

interface Props {
  month?: string;
  summary?: ExpenseMonthlySummary;
}

/** Three labels fit beside their amounts; the remainder collapses into a count. */
const MAX_INLINE_LABELS = 3;

const percentFormatter = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  maximumFractionDigits: 0,
});

const monthFormatter = new Intl.DateTimeFormat(LOCALE, {
  month: "long",
  year: "numeric",
});

/**
 * `YYYY-MM` is a form value, not something to read: the block states the month
 * in words. Anything else the caller passes is rendered as it came.
 */
function formatMonthLabel(month?: string | null) {
  if (!month) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const [, year, monthIndex] = match;
  return monthFormatter.format(new Date(Number(year), Number(monthIndex) - 1, 1));
}

/** A share that rounds to zero still happened, so it never reads as "0 %". */
function formatShare(share: number) {
  if (!Number.isFinite(share) || share <= 0) return percentFormatter.format(0);
  if (share < 0.005) return "<1 %";
  return percentFormatter.format(share);
}

/**
 * Track count for the cells that exist, so a strip of three never paints a
 * fourth, empty cell. The one-row layout waits for `xl`: at `lg` (1024px) six
 * cells would be too narrow for a currency amount to survive whole, so the
 * strip stays three across until there is room. Past six cells it wraps in
 * fours. Every class is written out because Tailwind cannot see an
 * interpolated name.
 */
const STRIP_COLUMNS: Record<number, string> = {
  1: "grid-cols-2 md:grid-cols-1 xl:grid-cols-1",
  2: "grid-cols-2 md:grid-cols-2 xl:grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3 xl:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-3 xl:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
};
const STRIP_FALLBACK_COLUMNS = "grid-cols-2 md:grid-cols-3 xl:grid-cols-4";

/**
 * One cell of the strip: a hairline on its right and bottom edge, no plate and
 * no fill of its own, so the strip reads as one surface divided up.
 */
const CELL_CLASSES = "min-w-0 border-b border-r border-border/60 p-4";

/**
 * Monthly summary as one ranked strip: the month total opens it, then one cell
 * per group carrying its amount and the labels behind it. Every number comes
 * from the summary endpoint; the component adds no money of its own.
 */
const PULSE = "animate-pulse [animation-duration:2.4s] motion-reduce:animate-none";

/**
 * While the summary request is in flight there is nothing true to say: a "$ 0"
 * or "Sin grupos" would be a claim, so the block keeps its shape and stays mute.
 */
function ExpenseSummaryPlaceholder() {
  return (
    <section
      aria-label="Resumen del mes"
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs"
    >
      <div
        aria-hidden="true"
        className="-mb-px -mr-px grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
      >
        {[0, 1, 2, 3].map((cell) => (
          <div
            key={cell}
            className={cn(
              CELL_CLASSES,
              cell === 0 && "col-span-2 md:col-span-1",
            )}
          >
            {cell === 0 ? (
              <>
                <p className="text-[13px] text-muted-foreground">Total del mes</p>
                <div className={`mt-1.5 h-7 w-40 rounded-md bg-muted-foreground/12 ${PULSE}`} />
              </>
            ) : (
              <div className={`h-3 w-2/3 rounded-full bg-muted-foreground/12 ${PULSE}`} />
            )}
            <div className={`mt-2 h-5 w-24 rounded-md bg-muted-foreground/12 ${PULSE}`} />
            <div className={`mt-2 h-2.5 w-full rounded-full bg-muted-foreground/10 ${PULSE}`} />
          </div>
        ))}
      </div>
      <span className="sr-only">Cargando resumen del mes…</span>
    </section>
  );
}

export function ExpenseSummaryCards({ month, summary }: Props) {
  if (!summary) return <ExpenseSummaryPlaceholder />;

  const groups = summary.groups ?? [];
  const ranked = [...groups]
    .sort((a, b) => toFiniteNumber(b.total) - toFiniteNumber(a.total))
    .map((group, index) => {
      const amount = toFiniteNumber(group.total);
      return {
        group,
        amount,
        color: CATEGORY_CHART_PALETTE[index % CATEGORY_CHART_PALETTE.length],
      };
    });

  // A stale or absent top-level total must not zero the shares for real groups.
  const groupTotal = ranked.reduce((sum, entry) => sum + entry.amount, 0);
  const total = toFiniteNumber(summary?.total) || groupTotal;
  const entries = ranked.map((entry) => ({
    ...entry,
    share: total > 0 ? entry.amount / total : 0,
  }));

  const columns = STRIP_COLUMNS[entries.length + 1] ?? STRIP_FALLBACK_COLUMNS;
  const period = formatMonthLabel(month ?? summary?.month);
  const groupCount = `${groups.length} ${
    groups.length === 1 ? "grupo" : "grupos"
  }`;

  return (
    <section
      aria-label="Resumen del mes"
      className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs"
    >
      {/*
        Cells of one surface, not cards: the hairlines are each cell's own right
        and bottom edge, pulled one pixel past the card so `overflow-hidden`
        trims them into the outer border, and the card's surface fills the last
        row when the cell count does not fill it.
      */}
      <div
        data-testid="expense-summary-strip"
        className={cn("-mb-px -mr-px grid", columns)}
      >
        <div className={cn(CELL_CLASSES, "col-span-2 md:col-span-1")}>
          <p className="text-[13px] text-muted-foreground">Total del mes</p>
          <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-[28px]">
            {formatCurrency(total)}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
            {period && <span className="truncate">{period}</span>}
            {period && (
              <span aria-hidden className="h-1 w-1 rounded-full bg-border" />
            )}
            <span className="tabular-nums">{groupCount}</span>
          </p>
          {entries.length === 0 && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Sin grupos con gastos este mes.
            </p>
          )}
        </div>

        {/* `contents` lets the list items be cells of the strip's own grid. */}
        <ol className="contents">
          {entries.map((entry) => {
            const labels = entry.group.labels ?? [];
            const inlineLabels = labels.slice(0, MAX_INLINE_LABELS);
            const hiddenLabels = labels.length - inlineLabels.length;
            return (
              <li key={entry.group.groupId} className={CELL_CLASSES}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span
                      title={entry.group.name}
                      className="truncate text-[13px] font-medium text-foreground"
                    >
                      {entry.group.name}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatShare(entry.share)}
                  </span>
                </div>

                <p className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground tabular-nums">
                  {formatCurrency(entry.amount)}
                </p>

                <div className="mt-2 space-y-1 text-[13px]">
                  {inlineLabels.length === 0 ? (
                    <p className="truncate text-muted-foreground">
                      Sin etiquetas
                    </p>
                  ) : (
                    inlineLabels.map((label) => (
                      <div
                        key={label.labelId}
                        className="flex items-baseline justify-between gap-2"
                      >
                        <span className="truncate text-muted-foreground">
                          {label.name}
                        </span>
                        <span className="shrink-0 font-medium text-foreground/80 tabular-nums">
                          {formatCurrency(toFiniteNumber(label.total))}
                        </span>
                      </div>
                    ))
                  )}
                  {hiddenLabels > 0 && (
                    <p className="text-xs text-muted-foreground">
                      +{hiddenLabels} más
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
