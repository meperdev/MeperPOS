"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { useLocations } from "@/hooks/useLocations";
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
  // Every site the caller may use; the principal one is the server's default and
  // the one the form starts on. `null` means "not chosen yet", so the principal
  // arrives with the directory instead of being copied into state.
  const sites = useLocations().data ?? [];
  const defaultSiteId = sites.find((site) => site.isDefault)?.id ?? "";
  const [pickedSiteId, setPickedSiteId] = useState<string | null>(null);
  // A destination must be a site of the loaded directory: while it loads, when
  // it is empty, or when the principal is not reachable and nothing was picked,
  // there is no destination and the receipt cannot be sent.
  const locationId = sites.some((site) => site.id === pickedSiteId)
    ? (pickedSiteId as string)
    : defaultSiteId;

  const siteOptions: SelectOption[] = sites.map((site) => ({
    value: site.id,
    label: site.name,
  }));
  // Only a different destination is worth sending; the principal is the default.
  const chosenSiteId =
    locationId && locationId !== defaultSiteId ? locationId : undefined;

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
    locationId !== "" &&
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
      const updated = await receive.mutateAsync({
        id: order.id,
        ...(chosenSiteId ? { locationId: chosenSiteId } : {}),
        items,
      });
      const statusLabel =
        updated.status === "RECEIVED"
          ? "Orden recibida completamente"
          : "Recepción parcial registrada";
      toast.success(statusLabel);
      // The next receipt starts on the principal site again.
      setPickedSiteId(null);
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
      className="px-2.5 text-right"
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
          <p className="text-sm text-muted-foreground">
            Ingresa la cantidad recibida ahora por cada producto. Los valores no
            pueden superar la cantidad pendiente.
          </p>

          {siteOptions.length > 0 && (
            <div className="space-y-1.5">
              <Select
                label="Sede de destino"
                options={siteOptions}
                value={locationId}
                placeholder="Selecciona una sede"
                onChange={setPickedSiteId}
              />
              <p className="text-[13px] text-muted-foreground">
                La mercancía entra al inventario de esta sede. La sede principal
                es la de por defecto.
              </p>
            </div>
          )}
          {siteOptions.length === 0 && (
            <p role="status" className="text-[13px] text-muted-foreground">
              Necesitas una sede asignada para registrar la recepción.
            </p>
          )}

          <div className="@container rounded-xl border border-border/70 bg-card overflow-hidden">
          <div className="hidden @2xl:block overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
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
                  <th scope="col" className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground w-32 min-w-32">
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
                      <p className="text-[13px] text-muted-foreground id-text">
                        {it.product?.sku}
                      </p>
                    </td>
                    <td className="py-2 px-3 text-right text-sm text-foreground tabular-nums">
                      {it.qtyOrdered}
                    </td>
                    <td className="py-2 px-3 text-right text-sm text-muted-foreground tabular-nums">
                      {it.qtyReceived}
                    </td>
                    <td className="py-2 px-3 text-right text-sm font-semibold text-warning-text tabular-nums">
                      {it.pending}
                    </td>
                    <td className="py-2 px-3">{renderReceiveInput(it)}</td>
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
                  <p className="text-[13px] text-muted-foreground id-text">
                    {it.product?.sku}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
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
