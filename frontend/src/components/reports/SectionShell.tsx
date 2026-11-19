"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The reports page section frame: one hairline card, a quiet title rail and a
 * body on the 4/8px grid. Every block on the page uses it so the left keyline
 * and the header rhythm stay identical from the first section to the last.
 */
export function SectionShell({
  title,
  icon: Icon,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  icon: LucideIcon;
  /** Quiet, one-line context next to the title (period, scope, cutoff). */
  description?: ReactNode;
  /** Header-right controls; kept inline so the title rail never wraps. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 className="truncate text-sm font-semibold tracking-tight text-foreground sm:text-sm">
            {title}
          </h2>
          {description && (
            <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground tabular-nums sm:inline">
              {description}
            </span>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
