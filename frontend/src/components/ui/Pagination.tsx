"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  pageSize?: number;
  itemLabel?: string;
  isDisabled?: boolean;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  itemLabel = "elemento",
  isDisabled = false,
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
  const pluralSuffix = totalItems !== 1 ? "s" : "";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 font-mono text-xs",
        className,
      )}
    >
      {hasRange ? (
        <p className="text-muted-foreground">
          Mostrando <span className="font-bold text-foreground">{rangeStart} - {rangeEnd}</span> de <span className="font-bold text-foreground">{totalItems}</span>
        </p>
      ) : hasTotal ? (
        <p className="text-muted-foreground">
          <span className="font-bold text-foreground">{totalItems}</span> {itemLabel}
          {pluralSuffix}
        </p>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-1.5 font-mono">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={prev}
          disabled={clamped <= 1 || isDisabled}
          className="h-7 px-2.5 py-1 rounded-md font-mono text-xs"
        >
          <ChevronLeft className="h-3.5 w-3.5 mr-1" />
          Anterior
        </Button>
        <span className="inline-flex h-7 items-center px-2.5 rounded-md bg-muted/60 border border-border/70 text-xs font-semibold tabular-nums text-foreground">
          {clamped} / {pageCount}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={next}
          disabled={clamped >= pageCount || isDisabled}
          className="h-7 px-2.5 py-1 rounded-md font-mono text-xs"
        >
          Siguiente
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}
