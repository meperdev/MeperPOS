"use client";

import { FileCheck } from "lucide-react";
import { ExpenseStatusBadge } from "./ExpenseStatusBadge";
import { RowActions, type RowActionItem } from "@/components/ui/RowActions";
import { activationProps } from "@/lib/activation";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Expense } from "@/types";

/** Names the record for assistive tech; the per-card icon controls repeat. */
export function expenseName(expense: Expense): string {
  return expense.label?.name ?? expense.description ?? "salida general";
}

/**
 * The one Salidas card. Phones and the desktop grid render the same component,
 * so the list cannot drift into two designs: category caption, the label as the
 * title, what was paid to whom and when, then the amount with its actions.
 *
 * The whole card opens the detail, the way a sale card does; the actions menu
 * keeps its own clicks so an operation never turns into "open".
 */
export function ExpenseCard({
  expense,
  actions,
  onOpenDetail,
}: {
  expense: Expense;
  actions: RowActionItem[];
  onOpenDetail: () => void;
}) {
  const isPaid = expense.status === "PAID";
  const paidSum = (expense.payments ?? []).reduce(
    (acc, payment) => acc + (Number(payment.amount) || 0),
    0,
  );
  const remaining = Math.max(Number(expense.total) - paidSum, 0);
  const name = expenseName(expense);
  const groupName = expense.label?.group?.name;

  return (
    <article
      {...activationProps(onOpenDetail, `Ver detalle de ${name}`)}
      className="flex cursor-pointer flex-col rounded-xl border border-border/70 bg-card p-3 shadow-2xs transition-colors hover:border-border active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {groupName && (
            <p className="truncate text-[13px] text-muted-foreground">
              {groupName}
            </p>
          )}
          <p className="truncate text-sm font-semibold text-foreground">
            {expense.label?.name ?? "Salida general"}
          </p>
        </div>
        <ExpenseStatusBadge status={expense.status} />
      </div>

      <p className="mt-2 line-clamp-2 text-[13px] text-muted-foreground">
        {expense.description ?? "Sin descripción"}
      </p>

      <dl className="mt-2 space-y-1 border-t border-border/50 pt-2 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Proveedor</dt>
          <dd className="truncate font-medium text-foreground">
            {expense.supplier?.name ?? "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Fecha</dt>
          <dd className="inline-flex items-center gap-1.5 tabular-nums text-foreground">
            {formatDate(expense.date)}
            {expense.receiptUrl && (
              <FileCheck
                className="h-3.5 w-3.5 shrink-0 text-success-text"
                aria-label="Comprobante adjunto"
              />
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-end justify-between gap-2 border-t border-border/60 pt-2">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">Total</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">
            {formatCurrency(Number(expense.total))}
          </p>
          {!isPaid && remaining > 0 && (
            <p className="text-[13px] text-warning-text tabular-nums">
              Saldo: {formatCurrency(remaining)}
            </p>
          )}
        </div>
        <div
          className="flex shrink-0 items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          <RowActions label={`Más acciones de ${name}`} items={actions} />
        </div>
      </div>
    </article>
  );
}
