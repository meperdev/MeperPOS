"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The page title rail: one h1, an optional result count, a one-line purpose and
 * the surface's actions, with the same spacing and wrap behaviour everywhere.
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
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {count !== undefined && count !== null && count !== "" && (
            <span className="hidden shrink-0 items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums sm:inline-flex">
              {count}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
