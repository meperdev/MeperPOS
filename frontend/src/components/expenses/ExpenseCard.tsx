"use client";

import { FileCheck } from "lucide-react";
import { ExpenseStatusBadge } from "./ExpenseStatusBadge";
import { RowActions, type RowActionItem } from "@/components/ui/RowActions";
import { SettledStrip } from "@/components/ui/SettledStrip";
import { activationProps } from "@/lib/activation";
import { cn, formatCurrency, formatDate, formatDateShort } from "@/lib/utils";
import type { Expense } from "@/types";

/** Names the record for assistive tech; the per-card icon controls repeat. */
export function expenseName(expense: Expense): string {
  return expense.label?.name ?? expense.description ?? "salida general";
}

/**
 * How much of the salida is already covered, for the card's progress bar.
 * Display only: the server owns the total and every payment, so the percentage
 * never travels and never feeds a stored figure.
 */
function paidPercentage(total: number, paid: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(Math.round((paid / total) * 100), 0), 100);
}

/**
 * The day of the last payment, for the settled line. Display only: the server
 * owns every payment, so this never feeds a stored figure.
 */
function latestPaymentDate(payments: Expense["payments"]): string | null {
  return (payments ?? []).reduce<string | null>((latest, payment) => {
    if (!payment.date) return latest;
    if (!latest) return payment.date;
    return new Date(payment.date).getTime() > new Date(latest).getTime()
      ? payment.date
      : latest;
  }, null);
}

/**
 * The one Salidas card. Phones and the desktop grid render the same component,
 * so the list cannot drift into two designs: category caption, the label as the
 * title, what was paid to whom and when, then the amount with its actions.
 *
 * The cards share a grid row, so each block reserves its own height and the
 * footer sits at the bottom (`mt-auto`): a one-line description and a truncated
 * supplier never shift the rows below them out of line.
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
  const total = Number(expense.total);
  const paidSum = (expense.payments ?? []).reduce(
    (acc, payment) => acc + (Number(payment.amount) || 0),
    0,
  );
  const remaining = Math.max(total - paidSum, 0);
  const percentage = paidPercentage(total, paidSum);
  // A salida with nothing left to pay reads settled: the bar has nothing to say,
  // so it becomes one muted line. The status field can lag behind the payments
  // table, hence the percentage check.
  const settled = expense.status === "PAID" || percentage >= 100;
  const lastPaymentDate = settled ? latestPaymentDate(expense.payments) : null;
  const hasBalance = remaining > 0;
  const name = expenseName(expense);
  const groupName = expense.label?.group?.name;

  return (
    <article
      {...activationProps(onOpenDetail, `Ver detalle de ${name}`)}
      className="flex h-full cursor-pointer flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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

      {/* Two lines are reserved whether the description fills them or not, so a
          short one does not lift the progress block above its neighbours'. */}
      <p className="line-clamp-2 min-h-[2lh] text-[13px] text-muted-foreground">
        {expense.description ?? "Sin descripción"}
      </p>

      {/* Paid so far against the total, like the loan and payroll cards: the bar
          reads at a glance what the caption then states exactly. A settled salida
          replaces the bar with the shared settled strip, so a page of completed
          cards does not turn into a column of full green bars — and the strip
          keeps the same height, so paid and pending cards stay aligned. */}
      {settled ? (
        <SettledStrip
          testId="expense-settled-line"
          label="Pagado completo"
          date={lastPaymentDate ? formatDateShort(lastPaymentDate) : null}
        />
      ) : (
        <div>
          <div
            role="progressbar"
            aria-label={`Pagado de ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              data-testid="expense-progress-fill"
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              Pagado {percentage}%
            </span>
            <span
              className={cn(
                "truncate text-xs font-semibold tabular-nums",
                hasBalance ? "text-warning-text" : "text-muted-foreground",
              )}
            >
              Saldo {formatCurrency(remaining)}
            </span>
          </div>
        </div>
      )}

      {/* One symmetric row: the supplier can truncate in its own cell without
          pushing the date, or the footer, around. */}
      <dl className="grid grid-cols-2 divide-x divide-border/60">
        <div className="min-w-0 px-3 first:pl-0">
          <dt className="text-xs text-muted-foreground">Proveedor</dt>
          <dd className="mt-0.5 truncate text-[13px] font-medium text-foreground">
            {expense.supplier?.name ?? "—"}
          </dd>
        </div>
        <div className="min-w-0 px-3 first:pl-0">
          <dt className="text-xs text-muted-foreground">Fecha</dt>
          <dd
            className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground"
            title={formatDate(expense.date)}
          >
            {formatDateShort(expense.date)}
            {expense.receiptUrl && (
              <FileCheck
                className="h-3.5 w-3.5 shrink-0 text-success-text"
                aria-label="Comprobante adjunto"
              />
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-end justify-between gap-2 border-t border-border/60 pt-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-base font-semibold tabular-nums text-foreground">
            {formatCurrency(total)}
          </p>
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
