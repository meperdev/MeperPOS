"use client";

import axios from "axios";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  usePurchaseOrder,
  useConfirmPurchaseOrder,
} from "@/hooks/usePurchaseOrders";
import { Button } from "@/components/ui/Button";
import { PurchaseOrderStatusBadge } from "@/components/purchase-orders/PurchaseOrderStatusBadge";
import { LoadingState } from "@/components/ui/LoadingState";
import { ReceiveItemsModal } from "@/components/purchase-orders/ReceiveItemsModal";
import { CancelPurchaseOrderModal } from "@/components/purchase-orders/CancelPurchaseOrderModal";
import { EditDraftModal } from "@/components/purchase-orders/EditDraftModal";
import {
  ArrowLeft,
  ClipboardList,
  CheckCircle2,
  PackageCheck,
  XCircle,
  StickyNote,
  Building2,
  CalendarDays,
  UserRound,
  Pencil,
} from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { hasAnyRole } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";

export default function PurchaseOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const toast = useToast();
  const { user } = useAuth();
  const canManage = hasAnyRole(user?.role, ["ADMIN", "INVENTORY_USER"]);

  const { data: order, isLoading, error } = usePurchaseOrder(id ?? "");
  const confirmOrder = useConfirmPurchaseOrder();

  const [showReceive, setShowReceive] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const errorMessage = useMemo(() => {
    if (!error) {
      return null;
    }

    if (axios.isAxiosError(error)) {
      if (error.response?.status === 403) {
        return "No tenes permisos para ver esta orden de compra.";
      }

      if (error.response?.status === 404) {
        return "La orden de compra no existe o fue eliminada.";
      }
    }

    return getApiErrorMessage(error, "No se pudo cargar la orden de compra.");
  }, [error]);

  const handleConfirm = async () => {
    if (!order) return;
    try {
      await confirmOrder.mutateAsync(order.id);
      toast.success(`OC-${order.orderNumber} confirmada`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo confirmar la orden"));
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <LoadingState icon={<ClipboardList className="w-4 h-4 text-primary/50" />} message="Cargando orden..." />
      </DashboardLayout>
    );
  }

  if (errorMessage || !order) {
    return (
      <DashboardLayout>
        <div className="rounded-2xl border border-border/60 bg-card p-8 text-center space-y-4">
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold text-foreground">
              No se pudo abrir la orden
            </h1>
            <p className="text-sm text-muted-foreground">
              {errorMessage ?? "La orden solicitada no esta disponible."}
            </p>
          </div>

          <div className="flex justify-center">
            <Button variant="secondary" onClick={() => router.push("/purchase-orders")}>
              Ir a órdenes
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const isDraft = order.status === "DRAFT";
  const isPending = order.status === "PENDING";
  const isPartial = order.status === "PARTIAL_RECEIVED";
  const isReceived = order.status === "RECEIVED";
  const isCancelled = order.status === "CANCELLED";
  const canReceive = canManage && (isPending || isPartial);
  const canConfirm = canManage && isDraft;
  const canCancel = canManage && (isDraft || isPending);

  return (
    <DashboardLayout>
      <div className="space-y-5 lg:space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <Link
              href="/purchase-orders"
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary mt-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Volver
            </Link>
            <div>
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <div className="w-1 h-7 rounded-full bg-primary shrink-0" />
                <h1 className="text-2xl lg:text-3xl font-bold text-foreground font-mono">
                  OC-{order.orderNumber}
                </h1>
                <PurchaseOrderStatusBadge status={order.status} />
              </div>
              <p className="text-sm text-muted-foreground ml-4">
                Detalle de la orden de compra
              </p>
            </div>
          </div>

          {canManage && (
            <div className="flex flex-wrap gap-2">
              {isDraft && (
                <Button variant="secondary" onClick={() => setShowEdit(true)}>
                  <Pencil className="w-4 h-4" /> Editar
                </Button>
              )}
              {canConfirm && (
                <Button
                  onClick={handleConfirm}
                  loading={confirmOrder.isPending}
                  variant="success"
                >
                  <CheckCircle2 className="w-4 h-4" /> Confirmar OC
                </Button>
              )}
              {canReceive && (
                <Button onClick={() => setShowReceive(true)}>
                  <PackageCheck className="w-4 h-4" />{" "}
                  {isPartial ? "Recibir pendientes" : "Recibir productos"}
                </Button>
              )}
              {canCancel && (
                <Button variant="danger" onClick={() => setShowCancel(true)}>
                  <XCircle className="w-4 h-4" /> Cancelar OC
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoField
                  icon={<Building2 className="w-3.5 h-3.5" />}
                  label="Proveedor"
                  value={order.supplier?.name ?? "—"}
                  sub={order.supplier?.documentNumber}
                />
                <InfoField
                  icon={<CalendarDays className="w-3.5 h-3.5" />}
                  label="Fecha de creación"
                  value={formatDateTime(order.createdAt)}
                />
                <InfoField
                  icon={<UserRound className="w-3.5 h-3.5" />}
                  label="Creado por"
                  value={order.createdBy?.name ?? "—"}
                />
                {order.confirmedAt && (
                  <InfoField
                    icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                    label="Confirmada"
                    value={formatDateTime(order.confirmedAt)}
                  />
                )}
                {order.receivedAt && (
                  <InfoField
                    icon={<PackageCheck className="w-3.5 h-3.5" />}
                    label="Recibida"
                    value={formatDateTime(order.receivedAt)}
                  />
                )}
                {order.cancelledAt && (
                  <InfoField
                    icon={<XCircle className="w-3.5 h-3.5" />}
                    label="Cancelada"
                    value={formatDateTime(order.cancelledAt)}
                    sub={order.cancelReason ?? undefined}
                  />
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border/60">
                <h2 className="text-sm font-semibold text-foreground">Items</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border/60">
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Producto
                      </th>
                      <th className="text-right py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Recibido / Ordenado
                      </th>
                      <th className="text-right py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Costo unit.
                      </th>
                      <th className="text-right py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        IVA %
                      </th>
                      <th className="text-right py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Subtotal
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.items ?? []).map((it) => (
                      <tr
                        key={it.id}
                        className="border-b border-border/40 last:border-b-0"
                      >
                        <td className="py-2.5 px-4">
                          <p className="text-sm font-medium text-foreground truncate max-w-[240px]">
                            {it.product?.name ?? "Producto eliminado"}
                          </p>
                          <p className="text-[11px] text-muted-foreground font-mono">
                            {it.product?.sku}
                          </p>
                        </td>
                        <td className="py-2.5 px-3 text-right text-sm font-mono">
                          <span
                            className={
                              it.qtyReceived >= it.qtyOrdered
                                ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                                : it.qtyReceived > 0
                                  ? "text-amber-600 dark:text-amber-400 font-semibold"
                                  : "text-muted-foreground"
                            }
                          >
                            {it.qtyReceived} / {it.qtyOrdered}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-sm text-foreground font-mono">
                          {formatCurrency(it.unitCost)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-sm text-muted-foreground font-mono">
                          {it.taxRate}%
                        </td>
                        <td className="py-2.5 px-4 text-right text-sm font-semibold text-foreground whitespace-nowrap">
                          {formatCurrency(it.subtotal + it.taxAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {order.notes && (
              <div className="rounded-2xl border border-border/60 bg-card p-5">
                <div className="flex items-center gap-2 mb-2">
                  <StickyNote className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">Notas</h2>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {order.notes}
                </p>
              </div>
            )}
          </div>

          <aside>
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5 space-y-3 sticky top-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Totales
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(order.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Impuestos</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(order.taxAmount)}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-primary/20">
                  <span className="font-bold text-foreground">Total</span>
                  <span className="stat-number text-xl font-bold text-primary">
                    {formatCurrency(order.total)}
                  </span>
                </div>
              </div>

              {(isReceived || isCancelled) && (
                <p className="text-[11px] text-muted-foreground pt-2 border-t border-primary/20">
                  Esta orden es de solo lectura.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>

      {canReceive && showReceive ? (
        <ReceiveItemsModal
          order={order}
          isOpen={showReceive}
          onClose={() => setShowReceive(false)}
        />
      ) : null}
      {isDraft && canManage && showEdit ? (
        <EditDraftModal
          order={order}
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
        />
      ) : null}
      {canCancel && showCancel ? (
        <CancelPurchaseOrderModal
          orderId={order.id}
          orderNumber={order.orderNumber}
          isOpen={showCancel}
          onClose={() => setShowCancel(false)}
        />
      ) : null}
    </DashboardLayout>
  );
}

function InfoField({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
        {icon} {label}
      </p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
