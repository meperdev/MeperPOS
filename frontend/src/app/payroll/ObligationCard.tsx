"use client";

import {
  CalendarDays,
  CalendarRange,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { RowActions, type RowActionItem } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn, toFiniteNumber } from "@/lib/utils";
import type {
  PayrollInstallment,
  PayrollObligation,
} from "@/hooks/usePayroll";
import { payrollDate, payrollDateShort, payrollMoney } from "./format";
import { PAYMENT_METHODS } from "./PayrollForm";

const KIND_LABELS: Record<PayrollObligation["kind"], string> = {
  FIXED_PERIOD: "Pago fijo",
  SHIFT_GROUP: "Pago por jornadas",
};

// The stored expense decision is a third axis of the payment, not a state: it
// says what happens to the cash expense when the payment becomes complete.
function expenseLabel(obligation: PayrollObligation): string {
  if (obligation.expenseEnabled === null) return "Gasto al completar: Sin definir";
  if (!obligation.expenseEnabled) return "Gasto al completar: No";
  return obligation.selectedExpenseDate
    ? `Gasto al completar: Sí · ${payrollDateShort(obligation.selectedExpenseDate)}`
    : "Gasto al completar: Sí";
}

function MoneyFact({
  label,
  value,
  testId,
  hasValue = true,
}: {
  label: string;
  value: string;
  testId: string;
  hasValue?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd
        data-testid={testId}
        className={cn(
          "whitespace-nowrap font-mono text-xs font-semibold tabular-nums",
          hasValue ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * One payroll obligation as a card: who and what kind, the server's own money
 * summary behind a progress bar, and the cash history. Every action the payment
 * allows lives in a single overflow menu whose entries change with its state.
 */
export interface ObligationActionHandlers {
  onRegisterInstallment: (obligation: PayrollObligation) => void;
  onCorrectInstallment: (obligation: PayrollObligation) => void;
  onRegisterCashReturn: (
    obligation: PayrollObligation,
    installment: PayrollInstallment,
  ) => void;
  onReplacePayment: (obligation: PayrollObligation) => void;
}

/** The card and the table row offer exactly the same actions. */
export function buildObligationActions(
  obligation: PayrollObligation,
  handlers: ObligationActionHandlers,
): RowActionItem[] {
  const completed = obligation.summary.status === "completed";
  const canCorrect =
    obligation.kind === "FIXED_PERIOD" && obligation.installments.length > 0;
  const actions: RowActionItem[] = [];
  if (!completed) {
    actions.push({
      label: "Registrar abono",
      icon: <Plus className="h-3.5 w-3.5" aria-hidden="true" />,
      onSelect: () => handlers.onRegisterInstallment(obligation),
    });
    if (canCorrect) {
      actions.push({
        label: "Corregir abono",
        icon: <Pencil className="h-3.5 w-3.5" aria-hidden="true" />,
        onSelect: () => handlers.onCorrectInstallment(obligation),
      });
    }
  } else {
    // A return covers exactly one complete installment, so the menu names the
    // installment it would return instead of offering an ambiguous "devolución".
    for (const installment of obligation.installments) {
      if (installment.cashReturn) continue;
      actions.push({
        label: "Registrar devolución",
        hint: `${payrollDateShort(installment.outflow.date)} · ${payrollMoney(installment.outflow.amount)}`,
        icon: <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />,
        onSelect: () => handlers.onRegisterCashReturn(obligation, installment),
      });
    }
    // S6/S7: only a COMPLETED payment can be replaced, and only by referencing
    // the installments it already paid — a payment with no installment has no
    // cash to reference.
    if (obligation.installments.length > 0) {
      actions.push({
        label: "Reemplazar pago",
        hint: "Nuevo pago con los abonos que siguen válidos",
        icon: <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />,
        onSelect: () => handlers.onReplacePayment(obligation),
      });
    }
  }

  return actions;
}

export function ObligationCard({
  obligation,
  employeeName,
  onRegisterInstallment,
  onCorrectInstallment,
  onRegisterCashReturn,
  onReplacePayment,
}: {
  obligation: PayrollObligation;
  employeeName: string;
  onRegisterInstallment: (obligation: PayrollObligation) => void;
  onCorrectInstallment: (obligation: PayrollObligation) => void;
  onRegisterCashReturn: (
    obligation: PayrollObligation,
    installment: PayrollInstallment,
  ) => void;
  onReplacePayment: (obligation: PayrollObligation) => void;
}) {
  const completed = obligation.summary.status === "completed";
  const total = toFiniteNumber(obligation.summary.total);
  const paid = toFiniteNumber(obligation.summary.paid);
  const progress =
    total > 0 ? Math.min(100, Math.max(0, Math.round((paid / total) * 100))) : 0;
  const hasBalance = toFiniteNumber(obligation.summary.balance) > 0;

  const actions = buildObligationActions(obligation, {
    onRegisterInstallment,
    onCorrectInstallment,
    onRegisterCashReturn,
    onReplacePayment,
  });

  const period =
    obligation.kind === "FIXED_PERIOD" &&
    obligation.periodStart &&
    obligation.periodEnd
      ? `${payrollDateShort(obligation.periodStart)} – ${payrollDateShort(obligation.periodEnd)}`
      : `${obligation.shiftMemberships.length} ${
          obligation.shiftMemberships.length === 1 ? "jornada" : "jornadas"
        }`;

  const PeriodIcon =
    obligation.kind === "FIXED_PERIOD" ? CalendarRange : CalendarDays;

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/50 text-muted-foreground"
          >
            <PeriodIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold leading-tight text-foreground">
              {employeeName}
            </h2>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {KIND_LABELS[obligation.kind]}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusBadge
            domain="payroll"
            status={completed ? "COMPLETED" : "PENDING"}
          />
          {actions.length > 0 && (
            <RowActions
              label={`Acciones de ${employeeName}`}
              items={actions}
              menuOffset={6}
            />
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{period}</span>
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <ReceiptText className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{expenseLabel(obligation)}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={`Pagado de ${employeeName}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary/80 transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {progress}%
          </span>
        </div>

        <dl className="space-y-1 rounded-xl border border-border/60 bg-muted/25 p-2.5">
          <MoneyFact
            label="Total"
            value={payrollMoney(obligation.summary.total)}
            testId={`summary-total-${obligation.id}`}
          />
          <MoneyFact
            label="Pagado"
            value={payrollMoney(obligation.summary.paid)}
            testId={`summary-paid-${obligation.id}`}
          />
          <MoneyFact
            label="Saldo"
            value={payrollMoney(obligation.summary.balance)}
            testId={`summary-balance-${obligation.id}`}
            hasValue={hasBalance}
          />
        </dl>

        <div className="space-y-1.5">
          <h3 className="text-[11px] font-medium text-muted-foreground">
            Abonos
          </h3>
          {obligation.installments.length ? (
            <ul className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/60">
              {obligation.installments.map((installment) => (
                <li
                  key={installment.id}
                  className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2.5 py-1.5"
                >
                  <span className="font-mono text-[11px] text-foreground tabular-nums">
                    {payrollDate(installment.outflow.date)} ·{" "}
                    {PAYMENT_METHODS[installment.outflow.method]} ·{" "}
                    {payrollMoney(installment.outflow.amount)}
                  </span>
                  {/* A returned installment keeps its cash row and shows the real
                      day and method the money came back by; it never offers a
                      second return. */}
                  {installment.cashReturn && (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      Devuelto el {payrollDate(installment.cashReturn.returnDate)}{" "}
                      · {PAYMENT_METHODS[installment.cashReturn.returnMethod]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">Sin abonos</p>
          )}
        </div>
      </div>
    </Card>
  );
}
