"use client";

import { ArrowLeftRight, ArrowRight } from "lucide-react";
import { RowActions, type RowActionItem } from "@/components/ui/RowActions";
import { TransferStatusBadge } from "@/components/transfers/TransferStatusBadge";
import { activationProps } from "@/lib/activation";
import { formatDateTime } from "@/lib/utils";
import type { StockTransfer } from "@/types";

/** Origin → destination, the one line that says what the document moves. */
export function TransferRoute({ transfer }: { transfer: StockTransfer }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm text-foreground">
        {transfer.fromLocation.name}
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      <span className="truncate text-sm text-foreground">
        {transfer.toLocation.name}
      </span>
    </span>
  );
}

/** Units travelling, summed from the lines the server already sent. */
function totalUnits(transfer: StockTransfer): number {
  return transfer.items.reduce(
    (total, item) => total + (Number(item.quantity) || 0),
    0,
  );
}

/**
 * One transfer as a card: the document number leads, the route says what moves,
 * and the footer states how much and when. It is the same card on a phone and in
 * the desktop grid, so the two views can never drift apart.
 *
 * The whole card opens the detail; the actions menu keeps its own clicks so an
 * operation never turns into "open".
 */
export function TransferCard({
  transfer,
  actions,
  onOpenDetail,
}: {
  transfer: StockTransfer;
  actions: RowActionItem[];
  onOpenDetail: () => void;
}) {
  const lines = transfer.items.length;
  const units = totalUnits(transfer);

  return (
    <article
      {...activationProps(
        onOpenDetail,
        `Ver transferencia TR-${transfer.number}`,
      )}
      className="group flex h-full cursor-pointer flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background active:bg-muted/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/50 text-muted-foreground">
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="id-text truncate text-sm font-semibold leading-tight text-foreground">
              TR-{transfer.number}
            </p>
            {/* A date reads as text, so it keeps proportional figures. */}
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {formatDateTime(transfer.createdAt)}
            </p>
          </div>
        </div>
        <TransferStatusBadge status={transfer.status} />
      </div>

      <div className="flex min-w-0 items-center rounded-lg bg-muted/40 px-2.5 py-2">
        <TransferRoute transfer={transfer} />
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 border-t border-border/60 pt-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Ítems</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[13px] font-medium text-foreground">
            <span className="tabular-nums">
              {lines} {lines === 1 ? "ítem" : "ítems"}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <span className="tabular-nums">{units} und.</span>
          </p>
        </div>
        <div
          className="shrink-0"
          onClick={(event) => event.stopPropagation()}
        >
          <RowActions
            label={`Más acciones de TR-${transfer.number}`}
            items={actions}
          />
        </div>
      </div>
    </article>
  );
}
