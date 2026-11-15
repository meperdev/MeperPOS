"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { pluralizeEs } from "@/lib/pluralize";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  pageSize?: number;
  itemLabel?: string;
  /** Needed only when the regular Spanish plural rule gives the wrong word (e.g. "orden"). */
  itemLabelPlural?: string;
  isDisabled?: boolean;
  /**
   * Pages pin the footer to the bottom of their flex column (the page root fills
   * the viewport, see DashboardLayout). Inline callers, such as modals, opt out.
   */
  pinned?: boolean;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  itemLabel = "elemento",
  itemLabelPlural,
  isDisabled = false,
  pinned = true,
  className,
}: PaginationProps) {
  // The footer stays on screen whenever there are results, so a one-page list
  // still shows its range and keeps the page from looking truncated.
  if (typeof totalItems === "number" ? totalItems <= 0 : totalPages <= 1) {
    return null;
  }

  const pageCount = Math.max(1, totalPages);
  const clamped = Math.max(1, Math.min(currentPage, pageCount));
  const prev = () => onPageChange(Math.max(1, clamped - 1));
  const next = () => onPageChange(Math.min(pageCount, clamped + 1));

  const hasTotal = typeof totalItems === "number";
  const hasRange = hasTotal && typeof pageSize === "number" && pageSize > 0;
  const rangeStart = hasRange ? (clamped - 1) * pageSize + 1 : 0;
  const rangeEnd = hasRange
    ? Math.min(clamped * pageSize, totalItems as number)
    : 0;
  const noun = totalItems === 1 ? itemLabel : (itemLabelPlural ?? pluralizeEs(itemLabel));

  return (
    // @container: the footer lays out by its own width, not the viewport, so a narrow
    // panel (the POS pager) gets the compact one-row form.
    <div
      className={cn(
        "@container flex flex-wrap items-center justify-between gap-3 text-xs",
        pinned &&
          "mt-auto sticky bottom-0 z-10 bg-background border-t border-border pt-3 pb-[max(0.75rem,var(--safe-bottom))]",
        className,
      )}
    >
      {hasRange ? (
        <>
          <p className="text-muted-foreground tabular-nums @md:hidden">
            {rangeStart}–{rangeEnd} de {totalItems}
          </p>
          <p className="hidden text-muted-foreground tabular-nums @md:block">
            Mostrando <span className="font-semibold text-foreground">{rangeStart} - {rangeEnd}</span> de <span className="font-semibold text-foreground">{totalItems}</span>
          </p>
        </>
      ) : hasTotal ? (
        <p className="text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground">{totalItems}</span> {noun}
        </p>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-1.5">
        {/* Below @md the buttons are icon-only; the word stays as the accessible name. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={prev}
          disabled={clamped <= 1 || isDisabled}
          className="h-10 w-10 p-0 rounded-md text-xs @md:h-9 @md:w-auto @md:px-3"
        >
          <ChevronLeft className="h-3.5 w-3.5 @md:mr-1" aria-hidden="true" />
          <span className="sr-only @md:not-sr-only">Anterior</span>
        </Button>
        <span className="inline-flex h-10 @md:h-9 items-center px-2.5 rounded-md bg-muted/60 border border-border/70 text-xs font-semibold tabular-nums text-foreground">
          {clamped} / {pageCount}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={next}
          disabled={clamped >= pageCount || isDisabled}
          className="h-10 w-10 p-0 rounded-md text-xs @md:h-9 @md:w-auto @md:px-3"
        >
          <span className="sr-only @md:not-sr-only">Siguiente</span>
          <ChevronRight className="h-3.5 w-3.5 @md:ml-1" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
