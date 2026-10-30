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
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
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
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";
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
        <LoadingState icon={<ClipboardList className="w-4 h-4 text-muted-foreground" />} message="Cargando orden..." />
      </DashboardLayout>
    );
  }

  if (errorMessage || !order) {
    return (
      <DashboardLayout>
        <div className="rounded-xl border border-border/70 bg-card p-8 text-center space-y-4 shadow-2xs">
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
      <div className="space-y-4 lg:space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link
              href="/purchase-orders"
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground mt-0.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Volver
            </Link>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-semibold text-foreground font-mono tracking-tight tabular-nums">
                  OC-{order.orderNumber}
                </h1>
                <PurchaseOrderStatusBadge status={order.status} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Detalle y seguimiento de la orden de compra
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <InfoField
                  icon={<Building2 className="w-3.5 h-3.5" />}
                  label="Proveedor"
                  value={order.supplier?.name ?? "—"}
                  sub={order.supplier?.documentNumber ? `NIT · ${order.supplier.documentNumber}` : undefined}
                />
                <InfoField
                  icon={<CalendarDays className="w-3.5 h-3.5" />}
                  label="Fecha de creación"
                  value={formatDateTime(order.createdAt)}
                  isDate
                />
                <InfoField
                  icon={<UserRound className="w-3.5 h-3.5" />}
                  label="Creado por"
                  value={order.createdBy?.name ?? "—"}
                />
                {order.confirmedAt && (
                  <InfoField
                    icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                    label="Confirmada"
                    value={formatDateTime(order.confirmedAt)}
                    isDate
                  />
                )}
                {order.receivedAt && (
                  <InfoField
                    icon={<PackageCheck className="w-3.5 h-3.5 text-emerald-500" />}
                    label="Recibida"
                    value={formatDateTime(order.receivedAt)}
                    isDate
                  />
                )}
                {order.cancelledAt && (
                  <InfoField
                    icon={<XCircle className="w-3.5 h-3.5 text-rose-500" />}
                    label="Cancelada"
                    value={formatDateTime(order.cancelledAt)}
                    sub={order.cancelReason ?? undefined}
                    isDate
                  />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden">
              <div className="px-4 py-3 border-b border-border/60">
                <h2 className="text-xs font-semibold text-foreground">
                  Productos en la orden
                </h2>
              </div>
              <div className="overflow-x-auto">
                <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableCell as="th">Producto</TableCell>
                    <TableCell as="th" className="text-right">
                      Recibido / Ordenado
                    </TableCell>
                    <TableCell as="th" className="text-right">
                      Costo unit.
                    </TableCell>
                    <TableCell as="th" className="text-right">
                      IVA
                    </TableCell>
                    <TableCell as="th" className="text-right">
                      Subtotal
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {(order.items ?? []).map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <p className="text-xs font-semibold text-foreground truncate max-w-[240px]">
                          {it.product?.name ?? "Producto eliminado"}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {it.product?.sku}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
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
                      </TableCell>
                      <TableCell className="text-right text-xs text-foreground font-mono tabular-nums">
                        {formatCurrency(it.unitCost)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground font-mono tabular-nums">
                        {it.taxRate}%
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-semibold text-foreground tabular-nums whitespace-nowrap">
                        {formatCurrency(it.subtotal + it.taxAmount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
                </Table>
              </div>
            </div>

            {order.notes && (
              <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
                <div className="flex items-center gap-2 mb-1.5">
                  <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
                  <h2 className="text-xs font-semibold text-foreground">
                    Observaciones
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {order.notes}
                </p>
              </div>
            )}
          </div>

          <aside>
            <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-2xs sticky top-4">
              <h3 className="text-xs font-semibold text-foreground">
                Resumen de costos
              </h3>
              <div className="space-y-2 pt-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-mono text-foreground tabular-nums">
                    {formatCurrency(order.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Impuestos</span>
                  <span className="font-mono text-foreground tabular-nums">
                    {formatCurrency(order.taxAmount)}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2.5 border-t border-border/60">
                  <span className="text-xs font-semibold text-foreground">
                    Total
                  </span>
                  <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                    {formatCurrency(order.total)}
                  </span>
                </div>
              </div>

              {(isReceived || isCancelled) && (
                <p className="text-[11px] text-muted-foreground pt-2 border-t border-border/60">
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
  isDate,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  isDate?: boolean;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-border/60">
      <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
        {icon} <span>{label}</span>
      </p>
      <p
        className={cn(
          "text-sm font-semibold text-foreground",
          isDate && "font-mono tabular-nums text-xs",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
