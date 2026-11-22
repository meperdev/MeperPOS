"use client";

import { Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineConfirmButton } from "@/components/ui/InlineConfirmButton";
import { Modal } from "@/components/ui/Modal";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import type { PausedSale } from "@/hooks/usePausedSales";

export interface PausedSalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  pausedSales: PausedSale[];
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatItemsPreview(cart: PausedSale["cart"]): string {
  if (cart.length === 0) return "Sin productos";
  const shown = cart
    .slice(0, 2)
    .map((item) => `${item.product.name} ×${item.quantity}`)
    .join(", ");
  const remaining = cart.length - 2;
  return remaining > 0 ? `${shown} +${remaining} más` : shown;
}

function computePausedTotal(sale: PausedSale): number {
  const itemsTotal = sale.cart.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice - item.discountAmount,
    0,
  );
  return Math.max(0, itemsTotal - (sale.discountAmount || 0));
}

/**
 * Dialog listing paused POS carts in a single hairline-divided list with
 * item preview, proportional timestamps, and compact resume/delete actions.
 */
export function PausedSalesModal({
  isOpen,
  onClose,
  pausedSales,
  onResume,
  onDelete,
}: PausedSalesModalProps) {
  const footer =
    pausedSales.length > 0 ? (
      <p className="text-[13px] text-muted-foreground tabular-nums">
        {pausedSales.length === 1
          ? "1 venta pausada"
          : `${pausedSales.length} ventas pausadas`}
      </p>
    ) : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Ventas pausadas"
      size="md"
      footer={footer}
    >
      {pausedSales.length === 0 ? (
        <EmptyState
          icon={<Pause className="h-5 w-5" />}
          title="No hay ventas pausadas"
          subtitle="Pausa una venta para que aparezca aquí"
        />
      ) : (
        <ul className="scrollbar-app max-h-[60vh] overflow-y-auto rounded-xl border border-border/70 bg-card divide-y divide-border/60">
          {pausedSales.map((sale) => {
            const productCount = sale.cart.length;
            const totalUnits = sale.cart.reduce(
              (sum, item) => sum + item.quantity,
              0,
            );
            return (
              <li
                key={sale.id}
                className="flex flex-col gap-3 p-3.5 transition-colors duration-150 hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:px-4"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p
                    className={cn(
                      "truncate text-sm",
                      sale.customerName
                        ? "font-semibold text-foreground"
                        : "font-medium text-muted-foreground",
                    )}
                  >
                    {sale.customerName || "Sin cliente"}
                  </p>
                  <p className="truncate text-[13px] text-foreground/80">
                    {formatItemsPreview(sale.cart)}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    <span className="tabular-nums">
                      {productCount === 1
                        ? "1 producto"
                        : `${productCount} productos`}
                      {totalUnits !== productCount ? ` (${totalUnits} und.)` : ""}
                    </span>
                    {" · "}
                    <span>{formatDateTime(sale.pausedAt)}</span>
                  </p>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                  <span className="stat-number text-base font-semibold tabular-nums text-foreground">
                    {formatCurrency(computePausedTotal(sale))}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onResume(sale.id)}
                      className="border-primary/35 bg-primary/10 text-primary-text hover:bg-primary hover:border-primary hover:text-white"
                    >
                      <Play className="w-3.5 h-3.5" aria-hidden="true" />
                      Reanudar
                    </Button>
                    <InlineConfirmButton
                      ariaLabel={
                        sale.customerName
                          ? `Eliminar venta pausada de ${sale.customerName}`
                          : "Eliminar venta pausada"
                      }
                      announce="Confirma para eliminar la venta pausada"
                      confirmLabel="¿Eliminar?"
                      onConfirm={() => onDelete(sale.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </InlineConfirmButton>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
