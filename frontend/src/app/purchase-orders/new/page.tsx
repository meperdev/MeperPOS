"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useProducts } from "@/hooks/useProducts";
import {
  useCreatePurchaseOrder,
  type CreatePurchaseOrderItemPayload,
} from "@/hooks/usePurchaseOrders";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { SearchField } from "@/components/ui/SearchField";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ArrowLeft, Plus, Trash2, ClipboardList } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import type { Product } from "@/types";

interface DraftItem extends CreatePurchaseOrderItemPayload {
  tempId: string;
  productName?: string;
  productSku?: string;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const toast = useToast();

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const { data: productsData } = useProducts({
    limit: 25,
    search: productSearch || undefined,
    status: "active",
  });
  const createPO = useCreatePurchaseOrder();

  const suppliers = suppliersData?.data ?? [];
  const products = productsData?.data ?? [];

  const totals = useMemo(() => {
    let subtotal = 0;
    let taxAmount = 0;
    for (const it of items) {
      const line = it.qtyOrdered * it.unitCost;
      subtotal += line;
      taxAmount += (line * it.taxRate) / 100;
    }
    return {
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
    };
  }, [items]);

  const addProduct = (product: Product) => {
    if (items.some((it) => it.productId === product.id)) {
      toast.error("Ese producto ya está en la orden");
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        tempId: genId(),
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        qtyOrdered: 1,
        unitCost: product.costPrice,
        taxRate: product.taxRate,
      },
    ]);
    setShowPicker(false);
    setProductSearch("");
  };

  const updateItem = (tempId: string, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.tempId === tempId ? { ...it, ...patch } : it)),
    );
  };

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((it) => it.tempId !== tempId));
  };

  const canSubmit =
    !!supplierId &&
    items.length > 0 &&
    items.every(
      (it) =>
        it.qtyOrdered > 0 &&
        it.unitCost >= 0 &&
        it.taxRate >= 0 &&
        it.taxRate <= 100,
    );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const created = await createPO.mutateAsync({
        supplierId,
        notes: notes.trim() || undefined,
        items: items.map((it) => ({
          productId: it.productId,
          qtyOrdered: it.qtyOrdered,
          unitCost: it.unitCost,
          taxRate: it.taxRate,
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
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Volver
          </Link>
          <PageHeader
            title="Nueva orden de compra"
            subtitle="Crea un borrador de compra para confirmar y recibir stock más tarde"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs space-y-4">
              <Select
                label="Proveedor *"
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Selecciona un proveedor..."
                options={[
                  { value: "", label: "Selecciona un proveedor..." },
                  ...suppliers.map((s) => ({
                    value: s.id,
                    label: `${s.name} — ${s.documentNumber}`,
                  })),
                ]}
              />

              <Input
                textarea
                rows={3}
                label="Notas u observaciones (opcional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Instrucciones de entrega, número de cotización o detalles del pedido…"
              />
            </div>

            <div className="rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                <h2 className="text-xs font-semibold text-foreground">
                  Productos en la orden ({items.length})
                </h2>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShowPicker((s) => !s)}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Agregar producto
                </Button>
              </div>

              {showPicker && (
                <div className="px-4 py-3 border-b border-border/60 bg-muted/30 space-y-2">
                  <SearchField
                    autoFocus
                    value={productSearch}
                    onChange={setProductSearch}
                    placeholder="Buscar producto por nombre o SKU…"
                    inputClassName="border border-border/70 bg-background text-sm"
                  />
                  <div className="max-h-60 overflow-y-auto rounded-lg border border-border/70 bg-card divide-y divide-border/60">
                    {products.length === 0 ? (
                      <p className="p-3 text-xs text-muted-foreground text-center">
                        Sin resultados para esa búsqueda
                      </p>
                    ) : (
                      products.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addProduct(p)}
                          className="w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {p.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground tabular-nums">
                              {p.sku} · Costo {formatCurrency(p.costPrice)}
                            </p>
                          </div>
                          <Plus className="w-4 h-4 text-primary-text shrink-0 ml-2" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {items.length === 0 ? (
                <EmptyState
                  icon={<ClipboardList className="w-5 h-5" />}
                  title="No hay productos agregados"
                  subtitle="Haz clic en “Agregar producto” para incorporar productos a la orden"
                />
              ) : (
                <div className="overflow-x-auto"><Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableCell as="th">Producto</TableCell>
                      <TableCell as="th" className="text-right w-24">
                        Cant.
                      </TableCell>
                      <TableCell as="th" className="text-right w-36">
                        Costo unit.
                      </TableCell>
                      <TableCell as="th" className="text-right w-24">
                        IVA %
                      </TableCell>
                      <TableCell as="th" className="text-right w-32">
                        Subtotal
                      </TableCell>
                      <TableCell as="th" className="w-10">
                        <span className="sr-only">Acciones</span>
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {items.map((it) => {
                      const lineSubtotal = it.qtyOrdered * it.unitCost;
                      return (
                        <TableRow key={it.tempId}>
                          <TableCell>
                            <p className="text-xs font-semibold text-foreground truncate max-w-[200px]">
                              {it.productName}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono">
                              {it.productSku}
                            </p>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={1}
                              aria-label={`Cantidad de ${it.productName ?? "producto"}`}
                              value={it.qtyOrdered}
                              onChange={(e) =>
                                updateItem(it.tempId, {
                                  qtyOrdered: Number(e.target.value) || 0,
                                })
                              }
                              className="text-right"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <CurrencyInput
                              value={it.unitCost}
                              onChange={(value) =>
                                updateItem(it.tempId, { unitCost: value })
                              }
                              className="text-right"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="0.1"
                              aria-label={`IVA de ${it.productName ?? "producto"}`}
                              value={it.taxRate}
                              onChange={(e) =>
                                updateItem(it.tempId, {
                                  taxRate: Number(e.target.value) || 0,
                                })
                              }
                              className="text-right"
                            />
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold text-foreground tabular-nums whitespace-nowrap">
                            {formatCurrency(lineSubtotal)}
                          </TableCell>
                          <TableCell className="text-right pr-2">
                            <button
                              type="button"
                              onClick={() => removeItem(it.tempId)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-danger-text hover:bg-danger/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                              aria-label={`Quitar ${it.productName ?? "producto"}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </tbody>
                </Table></div>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-2xs sticky top-[calc(var(--mobile-header)+var(--safe-top)+1rem)] lg:top-4">
              <h3 className="text-xs font-semibold text-foreground">
                Resumen de orden
              </h3>
              <div className="space-y-2 pt-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="text-foreground tabular-nums">
                    {formatCurrency(totals.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Impuestos</span>
                  <span className="text-foreground tabular-nums">
                    {formatCurrency(totals.taxAmount)}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2.5 border-t border-border/60">
                  <span className="text-xs font-semibold text-foreground">
                    Total
                  </span>
                  <span className="text-base font-semibold text-foreground tabular-nums">
                    {formatCurrency(totals.total)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-border/60">
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

              {!supplierId && (
                <p className="text-[11px] text-warning-text">
                  Selecciona un proveedor
                </p>
              )}
              {supplierId && items.length === 0 && (
                <p className="text-[11px] text-warning-text">
                  Agrega al menos un producto a la orden
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}
