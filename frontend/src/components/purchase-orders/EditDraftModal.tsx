"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  draftBlockingReasons,
  PurchaseOrderItemEditor,
  type PurchaseOrderItemRow,
} from "@/components/purchase-orders/PurchaseOrderItemEditor";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useUpdatePurchaseOrder } from "@/hooks/usePurchaseOrders";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import type { PurchaseOrder } from "@/types";

interface Props {
  order: PurchaseOrder;
  isOpen: boolean;
  onClose: () => void;
}

function buildDraftRows(order: PurchaseOrder): PurchaseOrderItemRow[] {
  return (order.items ?? []).map((item) => ({
    tempId: item.id,
    productId: item.productId,
    productName: item.product?.name ?? "",
    productSku: item.product?.sku ?? "",
    qtyOrdered: item.qtyOrdered,
    unitCost: item.unitCost,
    taxRate: item.taxRate,
  }));
}

export function EditDraftModal({ order, isOpen, onClose }: Props) {
  const toast = useToast();
  const updateOrder = useUpdatePurchaseOrder();
  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const suppliers = suppliersData?.data ?? [];

  const [supplierId, setSupplierId] = useState(order.supplierId);
  const [notes, setNotes] = useState(order.notes ?? "");
  const [rows, setRows] = useState<PurchaseOrderItemRow[]>(() => buildDraftRows(order));

  const totals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    for (const row of rows) {
      const line = row.qtyOrdered * row.unitCost;
      sub += line;
      tax += (line * row.taxRate) / 100;
    }
    return { sub, tax, total: sub + tax };
  }, [rows]);

  // Same rules the new-order page applies: one item editor, one definition of
  // what keeps a draft from being saved.
  const blockingReasons = draftBlockingReasons({ supplierId, items: rows });
  const canSubmit = blockingReasons.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await updateOrder.mutateAsync({
        id: order.id,
        data: {
          supplierId,
          notes: notes.trim() || undefined,
          items: rows.map((row) => ({
            productId: row.productId,
            qtyOrdered: row.qtyOrdered,
            unitCost: row.unitCost,
            taxRate: row.taxRate,
          })),
        },
      });
      toast.success("Borrador actualizado");
      onClose();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo actualizar la orden"));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Editar OC-${order.orderNumber}`}
      size="xl"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Proveedor"
            value={supplierId}
            onChange={(value) => setSupplierId(value)}
            options={suppliers.map((supplier) => ({
              value: supplier.id,
              label: supplier.name,
            }))}
          />
          <Input
            textarea
            rows={2}
            label="Notas"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <PurchaseOrderItemEditor title="Productos" rows={rows} onChange={setRows} />

        {blockingReasons.length > 0 && (
          <ul
            aria-live="polite"
            className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5"
          >
            {blockingReasons.map((reason) => (
              <li
                key={reason}
                className="flex items-start gap-1.5 text-[13px] text-warning-text"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warning"
                />
                {reason}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="text-[13px] text-muted-foreground">
            Total estimado:{" "}
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {formatCurrency(totals.total)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={updateOrder.isPending}
            >
              Guardar cambios
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
