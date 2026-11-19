"use client";

import Link from "next/link";
import { formatReportClockTime } from "@/lib/reportPresentation";
import { cn } from "@/lib/utils";
import type { StockAlertHistoryItem } from "@/hooks/useAlertNotifications";
import {
  ALERT_EVENT_KIND_META,
  alertProductHref,
  describeFailureReason,
  groupAlertEventsByDay,
  type AlertOutcomeTone,
} from "./alert-history";

const toneDotClass: Record<AlertOutcomeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/**
 * The notification history as a day list: one hairline card, a quiet band per
 * day, and one row per episode transition. A row is icon, product, the
 * identifiers behind it, the hour, and — only when a message was involved — the
 * WhatsApp outcome as a 6px dot plus its word.
 */
export function AlertHistoryList({
  items,
  className,
}: {
  items: StockAlertHistoryItem[];
  className?: string;
}) {
  const groups = groupAlertEventsByDay(items);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs",
        className,
      )}
    >
      {groups.map((group) => {
        const headingId = `alert-day-${group.key}`;

        return (
          <section
            key={group.key}
            aria-labelledby={headingId}
            className="border-t border-border/60 first:border-t-0"
          >
            <div className="flex items-baseline justify-between gap-3 border-b border-border/60 bg-muted/35 px-4 py-2">
              <h2
                id={headingId}
                className="min-w-0 truncate text-[13px] font-medium text-muted-foreground"
              >
                {group.label}
              </h2>
              <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                {group.items.length}
              </span>
            </div>
            <ul className="divide-y divide-border/60">
              {group.items.map((item) => (
                <AlertHistoryRow key={item.id} item={item} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AlertHistoryRow({ item }: { item: StockAlertHistoryItem }) {
  const meta = ALERT_EVENT_KIND_META[item.kind];
  const Icon = meta.icon;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <Link
          href={alertProductHref(item.kind)}
          aria-label={`${item.product.name} en inventario`}
          className="block truncate rounded-sm text-[13px] font-medium text-foreground underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          {item.product.name}
        </Link>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
          <span className="id-text tabular-nums">{item.product.sku}</span>
          {" · "}
          <span className="tabular-nums">episodio {item.episode}</span>
          {item.failureReason ? (
            <span> · {describeFailureReason(item.failureReason)}</span>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <time
          dateTime={item.createdAt}
          className="text-[13px] tabular-nums text-muted-foreground"
        >
          {formatReportClockTime(item.createdAt)}
        </time>
        <span
          data-outcome={meta.tone ?? "none"}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
        >
          {meta.tone ? (
            <span
              aria-hidden="true"
              className={cn("h-1.5 w-1.5 rounded-full", toneDotClass[meta.tone])}
            />
          ) : null}
          {meta.label}
        </span>
      </div>
    </li>
  );
}
