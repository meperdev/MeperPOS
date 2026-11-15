"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useReceivePurchaseOrder } from "@/hooks/usePurchaseOrders";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import type { PurchaseOrder } from "@/types";

interface Props {
  order: PurchaseOrder;
  isOpen: boolean;
  onClose: () => void;
  onReceived?: (updated: PurchaseOrder) => void;
}

function buildInitialValues(
  pendingItems: Array<{ id: string; pending: number }>,
) {
  const initial: Record<string, number> = {};
  for (const item of pendingItems) {
    initial[item.id] = item.pending;
  }
  return initial;
}

export function ReceiveItemsModal({ order, isOpen, onClose, onReceived }: Props) {
  const toast = useToast();
  const receive = useReceivePurchaseOrder();

  const pendingItems = useMemo(() => {
    return (order.items ?? [])
      .map((it) => ({
        ...it,
        pending: Math.max(0, it.qtyOrdered - it.qtyReceived),
      }))
      .filter((it) => it.pending > 0);
  }, [order.items]);

  const [values, setValues] = useState<Record<string, number>>(() =>
    buildInitialValues(pendingItems),
  );

  const totalPlanned = Object.values(values).reduce((a, b) => a + b, 0);

  const canSubmit =
    totalPlanned > 0 &&
    pendingItems.every((it) => {
      const v = values[it.id] ?? 0;
      return Number.isInteger(v) && v >= 0 && v <= it.pending;
    });

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const items = pendingItems
        .map((it) => ({ itemId: it.id, qtyReceivedNow: values[it.id] ?? 0 }))
        .filter((p) => p.qtyReceivedNow > 0);
      const updated = await receive.mutateAsync({ id: order.id, items });
      const statusLabel =
        updated.status === "RECEIVED"
          ? "Orden recibida completamente"
          : "Recepción parcial registrada";
      toast.success(statusLabel);
      onReceived?.(updated);
      onClose();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo registrar la recepción"));
    }
  };

  // Rendered by both the table (wide) and the stacked list (narrow). Only one
  // view is visible at a time, and both read the same `values` state.
  const renderReceiveInput = (it: (typeof pendingItems)[number]) => (
    <Input
      type="number"
      aria-label={`Cantidad a recibir de ${it.product?.name ?? "producto"}`}
      min={0}
      max={it.pending}
      step={1}
      value={values[it.id] ?? 0}
      onChange={(e) =>
        setValues((prev) => ({
          ...prev,
          [it.id]: Math.max(
            0,
            Math.min(it.pending, Math.floor(Number(e.target.value) || 0)),
          ),
        }))
      }
      className="text-right"
    />
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Recibir productos" size="lg">
      {pendingItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay productos pendientes por recibir.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Ingresa la cantidad recibida ahora por cada producto. Los valores no
            pueden superar la cantidad pendiente.
          </p>

          <div className="@container rounded-xl border border-border/70 bg-card overflow-hidden">
          <div className="hidden @2xl:block overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="bg-muted/35 border-b border-border/60">
                  <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">
                    Producto
                  </th>
                  <th scope="col" className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground">
                    Ordenado
                  </th>
                  <th scope="col" className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground">
                    Ya recibido
                  </th>
                  <th scope="col" className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground">
                    Pendiente
                  </th>
                  <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground w-32">
                    Recibir ahora
                  </th>
                </tr>
              </thead>
              <tbody>
                {pendingItems.map((it) => (
                  <tr
                    key={it.id}
                    className="border-b border-border/40 last:border-b-0"
                  >
                    <td className="py-2 px-4">
                      <p className="text-sm font-medium text-foreground truncate max-w-[200px]">
                        {it.product?.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {it.product?.sku}
                      </p>
                    </td>
                    <td className="py-2 px-3 text-right text-xs text-foreground tabular-nums">
                      {it.qtyOrdered}
                    </td>
                    <td className="py-2 px-3 text-right text-xs text-muted-foreground tabular-nums">
                      {it.qtyReceived}
                    </td>
                    <td className="py-2 px-3 text-right text-xs font-semibold text-warning-text tabular-nums">
                      {it.pending}
                    </td>
                    <td className="py-2 px-4">{renderReceiveInput(it)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div data-testid="receive-item-list" className="@2xl:hidden divide-y divide-border/60">
            {pendingItems.map((it) => (
              <div key={it.id} data-testid="receive-item-row" className="px-4 py-3 space-y-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground break-words">
                    {it.product?.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {it.product?.sku}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div className="space-y-0.5">
                    <dt className="text-muted-foreground">Ordenado</dt>
                    <dd className="text-foreground tabular-nums">{it.qtyOrdered}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-muted-foreground">Ya recibido</dt>
                    <dd className="text-muted-foreground tabular-nums">{it.qtyReceived}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-muted-foreground">Pendiente</dt>
                    <dd className="font-semibold text-warning-text tabular-nums">{it.pending}</dd>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <dt className="text-muted-foreground">Recibir ahora</dt>
                    <dd>{renderReceiveInput(it)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4 border-t border-border/60">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={receive.isPending}
            >
              Confirmar recepción
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
