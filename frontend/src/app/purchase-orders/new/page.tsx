"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useCreatePurchaseOrder } from "@/hooks/usePurchaseOrders";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  draftBlockingReasons,
  PurchaseOrderItemEditor,
  type PurchaseOrderItemRow,
} from "@/components/purchase-orders/PurchaseOrderItemEditor";
import { ArrowLeft, Info } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const toast = useToast();

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PurchaseOrderItemRow[]>([]);

  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const createPO = useCreatePurchaseOrder();

  const suppliers = suppliersData?.data ?? [];
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);

  // Display-only preview of the draft. The persisted numbers stay server-owned:
  // `POST /api/purchase-orders` recomputes every total from these items.
  const totals = useMemo(() => {
    let subtotal = 0;
    let taxAmount = 0;
    for (const item of items) {
      const line = item.qtyOrdered * item.unitCost;
      subtotal += line;
      taxAmount += (line * item.taxRate) / 100;
    }
    return { subtotal, taxAmount, total: subtotal + taxAmount };
  }, [items]);

  const count = (value: number, one: string, many: string) =>
    `${value} ${value === 1 ? one : many}`;

  const blockingReasons = draftBlockingReasons({ supplierId, items });

  const canSubmit = blockingReasons.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const created = await createPO.mutateAsync({
        supplierId,
        notes: notes.trim() || undefined,
        items: items.map((item) => ({
          productId: item.productId,
          qtyOrdered: item.qtyOrdered,
          unitCost: item.unitCost,
          taxRate: item.taxRate,
        })),
      });
      toast.success(`OC-${created.orderNumber} creada como borrador`);
      router.push(`/purchase-orders/${created.id}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo crear la orden"));
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 lg:space-y-5">
        <div className="space-y-3">
          <Link
            href="/purchase-orders"
            // S1.2: below lg the fixed top bar carries the back chevron, so this
            // copy is hidden there and kept for the desktop rail layout.
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "hidden lg:inline-flex",
            )}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Volver
          </Link>
          <PageHeader
            title="Nueva orden de compra"
            subtitle="Crea un borrador de compra para confirmar y recibir stock más tarde"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
          <div className="space-y-4 lg:col-span-2">
            <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
              <Select
                label="Proveedor *"
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Selecciona un proveedor..."
                options={[
                  { value: "", label: "Selecciona un proveedor..." },
                  ...suppliers.map((supplier) => ({
                    value: supplier.id,
                    label: `${supplier.name} — ${supplier.documentNumber}`,
                  })),
                ]}
              />

              <Input
                textarea
                rows={3}
                label="Notas u observaciones (opcional)"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Instrucciones de entrega, número de cotización o detalles del pedido…"
              />
            </div>

            <PurchaseOrderItemEditor rows={items} onChange={setItems} />
          </div>

          <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
            <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
              <h2 className="text-xs font-semibold text-foreground">Resumen de orden</h2>

              <dl className="space-y-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">Proveedor</dt>
                  <dd
                    className={cn(
                      "min-w-0 truncate text-right font-medium",
                      selectedSupplier ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {selectedSupplier?.name ?? "Sin proveedor"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Productos</dt>
                  <dd className="tabular-nums text-foreground">
                    {count(items.length, "producto", "productos")}
                  </dd>
                </div>

                <div className="space-y-2 border-t border-border/60 pt-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="tabular-nums text-foreground">
                      {formatCurrency(totals.subtotal)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Impuestos</dt>
                    <dd className="tabular-nums text-foreground">
                      {formatCurrency(totals.taxAmount)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
                    <dt className="text-xs font-semibold text-foreground">Total</dt>
                    <dd className="text-base font-semibold tabular-nums text-foreground">
                      {formatCurrency(totals.total)}
                    </dd>
                  </div>
                </div>
              </dl>

              <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  loading={createPO.isPending}
                  className="w-full"
                >
                  Guardar borrador
                </Button>
                <Link
                  href="/purchase-orders"
                  className={buttonClassName({ variant: "secondary", className: "w-full" })}
                >
                  Cancelar
                </Link>
              </div>

              {blockingReasons.length > 0 && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5"
                >
                  <p className="text-[11px] font-semibold text-warning-text">
                    Falta para guardar
                  </p>
                  <ul className="mt-1 space-y-1">
                    {blockingReasons.map((reason) => (
                      <li
                        key={reason}
                        className="flex items-start gap-1.5 text-[11px] text-warning-text"
                      >
                        <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warning" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <p className="flex items-start gap-1.5 px-1 text-[11px] text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
              Los totales son una vista previa: el servidor calcula los montos al
              guardar.
            </p>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}
