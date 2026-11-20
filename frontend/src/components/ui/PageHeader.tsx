"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The page title rail: one h1, an optional result count, a one-line purpose and
 * the surface's actions, with the same spacing and wrap behaviour everywhere.
 *
 * Below `lg` the section name already sits in the fixed mobile top bar, so the
 * heading stops painting a second copy of it — but it stays in the document, so
 * heading order and screen readers keep their landmark — and the actions take
 * the row instead of a full-width primary button. No media query can be observed
 * in jsdom; the class names are the contract.
 */
export function PageHeader({
  title,
  subtitle,
  count,
  actions,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Short result count, e.g. "12 registros". */
  count?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 max-lg:gap-0 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="sr-only text-xl font-semibold tracking-tight text-foreground sm:text-2xl lg:not-sr-only lg:truncate">
            {title}
          </h1>
          {count !== undefined && count !== null && count !== "" && (
            <span className="hidden shrink-0 items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums lg:inline-flex">
              {count}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="mt-0.5 hidden text-[13px] text-muted-foreground lg:block">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0 max-lg:[&>*]:w-auto">
          {actions}
        </div>
      )}
    </div>
  );
}
