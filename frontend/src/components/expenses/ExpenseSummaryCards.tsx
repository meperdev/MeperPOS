import { CATEGORY_CHART_PALETTE } from "@/lib/dashboard";
import { LOCALE } from "@/lib/constants";
import { formatCurrency, toFiniteNumber } from "@/lib/utils";
import type { ExpenseMonthlySummary } from "@/types";

interface Props {
  month?: string;
  summary?: ExpenseMonthlySummary;
}

/** Two labels read inline; anything past that collapses into a count. */
const MAX_INLINE_LABELS = 2;

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
 * Monthly summary as a hero total plus a ranked list: the month reads in words,
 * one bar carries the proportion, and every group repeats its segment colour.
 * Every number here comes from the summary endpoint; the component adds no
 * money of its own.
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
      className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs sm:p-5"
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
        <div className="min-w-0 lg:w-[min(45%,20rem)] lg:shrink-0">
          <p className="text-xs text-muted-foreground">Total del mes</p>
          <div className={`mt-2 h-8 w-44 rounded-md bg-muted-foreground/12 sm:h-9 ${PULSE}`} />
          <div className={`mt-2.5 h-2.5 w-32 rounded-full bg-muted-foreground/10 ${PULSE}`} />
          <div className={`mt-4 h-2.5 w-full rounded-full bg-muted ${PULSE}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-3 pt-1" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <span className={`h-1.5 w-1.5 rounded-full bg-muted-foreground/15 ${PULSE}`} />
              <span className={`h-2.5 w-1/3 rounded-full bg-muted-foreground/12 ${PULSE}`} />
              <span className={`ml-auto h-2.5 w-20 rounded-full bg-muted-foreground/12 ${PULSE}`} />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Cargando resumen del mes…</span>
    </section>
  );
}

/**
 * The hero total and the ranked rows are the design; the component adds no
 * money of its own — every figure comes from the summary endpoint.
 */
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

  // A stale or absent top-level total must not zero the bar for real groups.
  const groupTotal = ranked.reduce((sum, entry) => sum + entry.amount, 0);
  const total = toFiniteNumber(summary?.total) || groupTotal;
  const entries = ranked.map((entry) => ({
    ...entry,
    share: total > 0 ? entry.amount / total : 0,
  }));

  const period = formatMonthLabel(month ?? summary?.month);
  const groupCount = `${groups.length} ${
    groups.length === 1 ? "grupo" : "grupos"
  }`;

  const distributionLabel =
    entries.length === 0
      ? "Distribución del mes: sin grupos con gastos"
      : `Distribución del mes: ${entries
          .map((entry) => `${entry.group.name} ${formatShare(entry.share)}`)
          .join(", ")}`;

  return (
    <section
      aria-label="Resumen del mes"
      className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs sm:p-5"
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
        <div className="min-w-0 lg:w-[min(45%,20rem)] lg:shrink-0">
          <p className="text-xs text-muted-foreground">Total del mes</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-foreground tabular-nums sm:text-[28px]">
            {formatCurrency(total)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {period && <span className="truncate">{period}</span>}
            {period && (
              <span aria-hidden className="h-1 w-1 rounded-full bg-border" />
            )}
            <span className="tabular-nums">{groupCount}</span>
          </div>

          {/*
            One proportion, not a chart: the segments share a single track, each
            one a categorical chart token so it repeats on its row below.
          */}
          <div
            role="img"
            aria-label={distributionLabel}
            className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
          >
            {entries.map((entry) => (
              <span
                key={entry.group.groupId}
                className="block h-full"
                style={{
                  backgroundColor: entry.color,
                  width: `${entry.share * 100}%`,
                }}
              />
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sin grupos con gastos este mes.
            </p>
          ) : (
            <ol className="divide-y divide-border/60">
              {entries.map((entry) => {
                const labels = entry.group.labels ?? [];
                const inlineLabels = labels.slice(0, MAX_INLINE_LABELS);
                const hiddenLabels = labels.length - inlineLabels.length;
                return (
                  <li
                    key={entry.group.groupId}
                    className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-foreground">
                        {entry.group.name}
                      </span>
                      <span className="mt-0.5 flex items-baseline gap-1 text-xs text-muted-foreground">
                        <span className="truncate">
                          {inlineLabels.length === 0
                            ? "Sin etiquetas"
                            : inlineLabels
                                .map((label) => label.name)
                                .join(" · ")}
                        </span>
                        {hiddenLabels > 0 && (
                          <span className="shrink-0 tabular-nums">
                            +{hiddenLabels}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[13px] font-medium text-foreground tabular-nums">
                      {formatCurrency(entry.amount)}
                    </span>
                    <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {formatShare(entry.share)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
