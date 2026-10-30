"use client";

import type { ComponentType } from "react";
import {
  CreditCard,
  DollarSign,
  FileText,
  HandCoins,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Payment } from "@/types";

/**
 * One colour per payment state, shared by every surface that prints it
 * (sales list, sale detail, dashboard peek). `financed` wins over the rows: a
 * POS-financed sale settles through its loan and carries no payments.
 */
type PaymentStateKey = "CASH" | "CARD" | "TRANSFER" | "MIXED" | "FINANCED" | "NONE";

interface PaymentState {
  key: PaymentStateKey;
  label: string;
  short: string;
  className: string;
  Icon: ComponentType<{ className?: string }> | null;
}

const STATES: Record<PaymentStateKey, PaymentState> = {
  CASH: {
    key: "CASH",
    label: "Efectivo",
    short: "Efec",
    className: "text-emerald-600 dark:text-emerald-400",
    Icon: DollarSign,
  },
  CARD: {
    key: "CARD",
    label: "Tarjeta",
    short: "Tarj",
    className: "text-sky-600 dark:text-sky-400",
    Icon: CreditCard,
  },
  TRANSFER: {
    key: "TRANSFER",
    label: "Transferencia",
    short: "Trans",
    className: "text-amber-600 dark:text-amber-400",
    Icon: Smartphone,
  },
  MIXED: {
    key: "MIXED",
    label: "Mixto",
    short: "Mixto",
    className: "text-fuchsia-600 dark:text-fuchsia-400",
    Icon: FileText,
  },
  FINANCED: {
    key: "FINANCED",
    label: "Financiado",
    short: "Financ.",
    className: "text-violet-600 dark:text-violet-400",
    Icon: HandCoins,
  },
  NONE: {
    key: "NONE",
    label: "Sin pago",
    short: "—",
    className: "text-muted-foreground",
    Icon: null,
  },
};

export function getPaymentState(
  payments?: Array<Pick<Payment, "method">> | null,
  financed?: boolean,
): PaymentState {
  if (financed) return STATES.FINANCED;
  if (!payments || payments.length === 0) return STATES.NONE;
  if (payments.length > 1) return STATES.MIXED;
  const method = payments[0]?.method;
  if (method === "CASH" || method === "CARD" || method === "TRANSFER") {
    return STATES[method];
  }
  return STATES.NONE;
}

/**
 * Icon + label in the state colour. `short` keeps a two-line-safe abbreviation
 * under `sm` (the mobile cards) and the full label from `sm` up.
 */
export function PaymentStateBadge({
  payments,
  financed,
  short = false,
  className,
}: {
  payments?: Array<Pick<Payment, "method">> | null;
  financed?: boolean;
  short?: boolean;
  className?: string;
}) {
  const state = getPaymentState(payments, financed);
  const { Icon } = state;

  if (!Icon) {
    return (
      <span className={cn("text-xs", state.className, className)}>
        {state.label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        state.className,
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {short ? (
        <>
          <span className="hidden sm:inline">{state.label}</span>
          <span className="sm:hidden">{state.short}</span>
        </>
      ) : (
        <span>{state.label}</span>
      )}
    </span>
  );
}
