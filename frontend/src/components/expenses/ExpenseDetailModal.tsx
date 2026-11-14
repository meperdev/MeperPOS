"use client";

import Image from "next/image";
import { Modal } from "@/components/ui/Modal";
import { ExpenseStatusBadge } from "@/components/expenses/ExpenseStatusBadge";
import { useExpenseHistory } from "@/hooks/useExpenses";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { FileText, Image as ImageIcon } from "lucide-react";
import type { Expense, ExpensePayment } from "@/types";

interface Props {
  expense: Expense;
  isOpen: boolean;
  onClose: () => void;
}

const PAYMENT_METHOD_LABELS: Record<ExpensePayment["method"], string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
};

function InfoItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5", className)}>
      <p className="text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-xs font-semibold text-foreground break-words leading-snug">
        {value}
      </p>
    </div>
  );
}

export function ExpenseDetailModal({ expense, isOpen, onClose }: Props) {
  useExpenseHistory(expense.id);

  const payments = expense.payments ?? [];
  const paidSum = payments.reduce(
    (acc, payment) => acc + (Number(payment.amount) || 0),
    0,
  );
  const remaining = Math.max(Number(expense.total) - paidSum, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Detalle del Gasto" size="xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left Column: Info, Amounts and Payments */}
        <div className="space-y-4 flex flex-col justify-between">
          <div className="space-y-3.5">
            {/* Header / Summary Card */}
            <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Total Registrado
                </p>
                <p className="font-mono text-xl sm:text-2xl font-semibold text-foreground tracking-tight tabular-nums mt-0.5">
                  {formatCurrency(Number(expense.total))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground font-mono tabular-nums">
                  Fecha: {formatDate(expense.date)}
                </p>
              </div>
              <ExpenseStatusBadge status={expense.status} />
            </div>

            {/* Grid Details */}
            <div className="grid grid-cols-2 gap-2.5">
              <InfoItem
                label="Grupo / etiqueta"
                value={expense.label?.group?.name ? `${expense.label.group.name} / ${expense.label.name}` : expense.label?.name ?? "—"}
              />
              <InfoItem label="Proveedor" value={expense.supplier?.name ?? "—"} />
              {expense.purchaseOrder ? (
                <>
                  <InfoItem
                    label="Orden de Compra"
                    value={`OC-${expense.purchaseOrder.orderNumber}`}
                  />
                  <InfoItem label="Descripción" value={expense.description ?? "—"} />
                </>
              ) : (
                <InfoItem
                  label="Descripción"
                  value={expense.description ?? "—"}
                  className="col-span-2"
                />
              )}
            </div>

            {/* Payments List */}
            <div className="rounded-xl border border-border/70 bg-card p-4 space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Abonos y Pagos ({payments.length})
                </span>
                <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                  Pagado: {formatCurrency(paidSum)}
                </span>
              </div>

              {payments.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">
                  No hay pagos registrados.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
                  {payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 border border-border/50 text-xs font-mono tabular-nums"
                    >
                      <span className="font-medium text-foreground">
                        {PAYMENT_METHOD_LABELS[p.method] || p.method}
                      </span>
                      <span className="font-semibold text-foreground tabular-nums">
                        {formatCurrency(Number(p.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {remaining > 0 && (
                <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="text-muted-foreground font-medium">Pendiente:</span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {formatCurrency(remaining)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Receipt / Invoice Preview (Zero scroll) */}
        <div className="rounded-xl border border-border/70 bg-card p-4 flex flex-col shadow-2xs">
          <div className="flex items-center gap-2 pb-2.5 border-b border-border/60 mb-3">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">
              Comprobante / Factura Adjunta
            </span>
          </div>

          <div className="flex-1 min-h-[260px] rounded-xl border border-border/60 bg-muted/20 relative overflow-hidden flex items-center justify-center">
            {expense.receiptUrl ? (
              <Image
                src={expense.receiptUrl}
                alt="Comprobante del gasto"
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                unoptimized
                className="object-contain p-2"
              />
            ) : (
              <div className="text-center p-4">
                <ImageIcon className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">
                  Sin factura o comprobante adjunto
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
