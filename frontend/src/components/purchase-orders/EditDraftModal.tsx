"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { SearchField } from "@/components/ui/SearchField";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useProducts } from "@/hooks/useProducts";
import { useUpdatePurchaseOrder } from "@/hooks/usePurchaseOrders";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import type { PurchaseOrder, Product } from "@/types";

interface Props {
  order: PurchaseOrder;
  isOpen: boolean;
  onClose: () => void;
}

interface DraftRow {
  tempId: string;
  productId: string;
  productName: string;
  productSku: string;
  qtyOrdered: number;
  unitCost: number;
  taxRate: number;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function buildDraftRows(order: PurchaseOrder): DraftRow[] {
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
  const [rows, setRows] = useState<DraftRow[]>(() => buildDraftRows(order));
  const [productSearch, setProductSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const { data: productsData } = useProducts({
    limit: 25,
    search: productSearch || undefined,
    status: "active",
  });
  const products = productsData?.data ?? [];

  const addProduct = (p: Product) => {
    if (rows.some((r) => r.productId === p.id)) {
      toast.error("Producto ya agregado");
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        tempId: genId(),
        productId: p.id,
        productName: p.name,
        productSku: p.sku,
        qtyOrdered: 1,
        unitCost: p.costPrice,
        taxRate: p.taxRate,
      },
    ]);
    setShowPicker(false);
    setProductSearch("");
  };

  const totals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    for (const r of rows) {
      const line = r.qtyOrdered * r.unitCost;
      sub += line;
      tax += (line * r.taxRate) / 100;
    }
    return { sub, tax, total: sub + tax };
  }, [rows]);

  const canSubmit =
    !!supplierId &&
    rows.length > 0 &&
    rows.every((r) => r.qtyOrdered > 0 && r.unitCost >= 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await updateOrder.mutateAsync({
        id: order.id,
        data: {
          supplierId,
          notes: notes.trim() || undefined,
          items: rows.map((r) => ({
            productId: r.productId,
            qtyOrdered: r.qtyOrdered,
            unitCost: r.unitCost,
            taxRate: r.taxRate,
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BentoSelect
            label="Proveedor"
            value={supplierId}
            onChange={(value) => setSupplierId(value)}
            options={suppliers.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Notas
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-border focus:bg-background transition-colors resize-none"
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30">
            <span className="text-xs font-semibold text-foreground">Items</span>
            <Button
              size="sm"
              type="button"
              onClick={() => setShowPicker((s) => !s)}
            >
              <Plus className="w-3.5 h-3.5" /> Agregar
            </Button>
          </div>
          {showPicker && (
            <div className="px-4 py-3 border-b border-border/60 bg-muted/20 space-y-2">
              <SearchField
                autoFocus
                value={productSearch}
                onChange={setProductSearch}
                placeholder="Buscar producto..."
                inputClassName="border border-border/70 bg-card text-sm"
              />
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border/60 bg-card divide-y divide-border/60">
                {products.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground text-center">
                    Sin resultados
                  </p>
                ) : (
                  products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProduct(p)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-primary/5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {p.sku}
                        </p>
                      </div>
                      <Plus className="w-4 h-4 text-primary" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="bg-muted/35 border-b border-border/60">
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground">
                    Producto
                  </th>
                  <th className="text-right py-2.5 px-2 text-xs font-medium text-muted-foreground w-20">
                    Cant.
                  </th>
                  <th className="text-right py-2.5 px-2 text-xs font-medium text-muted-foreground w-28">
                    Costo
                  </th>
                  <th className="text-right py-2.5 px-2 text-xs font-medium text-muted-foreground w-20">
                    IVA %
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                      Agrega productos
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.tempId}
                      className="border-b border-border/40 last:border-b-0"
                    >
                      <td className="py-2 px-3">
                        <p className="text-sm font-medium truncate max-w-[180px]">
                          {r.productName}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {r.productSku}
                        </p>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min={1}
                          value={r.qtyOrdered}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((x) =>
                                x.tempId === r.tempId
                                  ? { ...x, qtyOrdered: Number(e.target.value) || 0 }
                                  : x,
                              ),
                            )
                          }
                          className="w-full h-8 rounded-lg border border-border/70 bg-muted/30 px-2 text-right text-xs font-mono tabular-nums text-foreground focus:outline-none focus:border-border focus:bg-background transition-colors"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <CurrencyInput
                          value={r.unitCost}
                          onChange={(value) =>
                            setRows((prev) =>
                              prev.map((x) =>
                                x.tempId === r.tempId
                                  ? { ...x, unitCost: value }
                                  : x,
                              ),
                            )
                          }
                          className="text-right"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          value={r.taxRate}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((x) =>
                                x.tempId === r.tempId
                                  ? { ...x, taxRate: Number(e.target.value) || 0 }
                                  : x,
                              ),
                            )
                          }
                          className="w-full h-8 rounded-lg border border-border/70 bg-muted/30 px-2 text-right text-xs font-mono tabular-nums text-foreground focus:outline-none focus:border-border focus:bg-background transition-colors"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <button
                          type="button"
                          onClick={() =>
                            setRows((prev) => prev.filter((x) => x.tempId !== r.tempId))
                          }
                          className="p-1 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border/60">
          <div className="text-xs text-muted-foreground">
            Total estimado:{" "}
            <span className="text-sm font-mono font-semibold text-foreground tabular-nums">
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
