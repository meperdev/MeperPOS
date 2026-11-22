"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

const PULSE = "animate-pulse [animation-duration:2.4s] motion-reduce:animate-none";

/**
 * While the summary request is in flight there is nothing true to say: a "$ 0"
 * or "Sin grupos" would be a claim, so the block keeps its single-row pinned
 * total + category strip shape and stays mute.
 */
function ExpenseSummaryPlaceholder() {
  return (
    <section
      aria-label="Resumen del mes"
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs"
    >
      <div aria-hidden="true" className="flex flex-col md:flex-row">
        <div className="shrink-0 border-b border-border/60 p-4 md:w-64 md:border-b-0 md:border-r lg:w-72">
          <p className="text-[13px] text-muted-foreground">Total del mes</p>
          <div className={`mt-1.5 h-7 w-40 rounded-md bg-muted-foreground/12 ${PULSE}`} />
          <div className={`mt-2 h-3 w-32 rounded-full bg-muted-foreground/10 ${PULSE}`} />
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-1 divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[0, 1, 2].map((cell) => (
            <div key={cell} className="min-w-0 p-4">
              <div className={`h-3 w-2/3 rounded-full bg-muted-foreground/12 ${PULSE}`} />
              <div className={`mt-2 h-5 w-24 rounded-md bg-muted-foreground/12 ${PULSE}`} />
              <div className={`mt-2 h-2.5 w-full rounded-full bg-muted-foreground/10 ${PULSE}`} />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Cargando resumen del mes…</span>
    </section>
  );
}

/**
 * Monthly summary as one fixed-height strip: `Total del mes` stays pinned on
 * the left while ranked category cells ride a single horizontal rail with
 * discreet overflow arrows and an alpha edge fade, so any number of groups
 * stays on one row without vertical stacking or numbered pagination.
 */
export function ExpenseSummaryCards({ month, summary }: Props) {
  const railRef = useRef<HTMLOListElement | null>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const groups = summary?.groups ?? [];
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

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;

    const sync = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setScrollState((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };

    const raf = window.requestAnimationFrame(sync);
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    observer?.observe(el);

    return () => {
      window.cancelAnimationFrame(raf);
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      observer?.disconnect();
    };
  }, [entries.length, total]);

  if (!summary) return <ExpenseSummaryPlaceholder />;

  const period = formatMonthLabel(month ?? summary?.month);
  const groupCount = `${groups.length} ${
    groups.length === 1 ? "grupo" : "grupos"
  }`;

  const canScrollLeft = entries.length > 0 && scrollState.left;
  const canScrollRight = entries.length > 0 && scrollState.right;
  const hasOverflow = canScrollLeft || canScrollRight;

  const fadeEdge =
    canScrollLeft && canScrollRight
      ? "both"
      : canScrollRight
        ? "right"
        : canScrollLeft
          ? "left"
          : undefined;

  const scrollRail = (direction: -1 | 1) => {
    const el = railRef.current;
    if (!el) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = Math.max(240, Math.round((el.clientWidth || 248) * 0.75));
    el.scrollBy?.({
      left: direction * step,
      behavior: prefersReduced ? "auto" : "smooth",
    });
  };

  return (
    <section
      aria-label="Resumen del mes"
      className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs"
    >
      <div
        data-testid="expense-summary-strip"
        className="flex flex-col md:flex-row"
      >
        <div
          className={cn(
            "flex shrink-0 flex-col justify-between p-4",
            entries.length > 0
              ? "border-b border-border/60 md:w-64 md:border-b-0 md:border-r lg:w-72"
              : "w-full",
          )}
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-muted-foreground">Total del mes</p>
              {hasOverflow && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => scrollRail(-1)}
                    disabled={!canScrollLeft}
                    aria-label="Categorías anteriores"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-card text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollRail(1)}
                    disabled={!canScrollRight}
                    aria-label="Siguientes categorías"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-card text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-[28px]">
              {formatCurrency(total)}
            </p>
          </div>

          <div>
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
        </div>

        {entries.length > 0 && (
          <ol
            ref={railRef}
            data-testid="expense-summary-rail"
            data-fade={fadeEdge}
            className="expense-summary-rail scrollbar-hide flex min-w-0 flex-1 overflow-x-auto snap-x snap-mandatory"
          >
            {entries.map((entry) => {
              const labels = entry.group.labels ?? [];
              const inlineLabels = labels.slice(0, MAX_INLINE_LABELS);
              const hiddenLabels = labels.length - inlineLabels.length;
              return (
                <li
                  key={entry.group.groupId}
                  className="min-w-0 grow shrink-0 basis-[232px] snap-start border-r border-border/60 p-4 last:border-r-0 sm:basis-[248px]"
                >
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
        )}
      </div>
    </section>
  );
}
