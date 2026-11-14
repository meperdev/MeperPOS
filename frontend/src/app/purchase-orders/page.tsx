"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useSuppliers } from "@/hooks/useSuppliers";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { PurchaseOrderStatusBadge } from "@/components/purchase-orders/PurchaseOrderStatusBadge";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar, FilterClearButton } from "@/components/ui/FilterBar";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
import {
  Plus,
  Eye,
  ClipboardList,
  Truck,
  Calendar,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { hasAnyRole } from "@/lib/auth";
import type { PurchaseOrderStatus } from "@/types";
import { useAuth } from "@/contexts/AuthContext";

const statusOptions: Array<{ value: "" | PurchaseOrderStatus; label: string }> = [
  { value: "", label: "Todos los estados" },
  { value: "DRAFT", label: "Borrador" },
  { value: "PENDING", label: "Pendiente" },
  { value: "PARTIAL_RECEIVED", label: "Recibida parcialmente" },
  { value: "RECEIVED", label: "Recibida" },
  { value: "CANCELLED", label: "Cancelada" },
];

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canManage = hasAnyRole(user?.role, ["ADMIN", "INVENTORY_USER"]);

  const [q, setQ] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<"" | PurchaseOrderStatus>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = usePersistedViewMode("purchase-orders");

  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const { data, isLoading } = usePurchaseOrders({
    page,
    limit: viewMode === "grid" ? 12 : 10,
    q: q.trim() || undefined,
    supplierId: supplierId || undefined,
    status: status || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const orders = data?.data ?? [];
  const meta = data?.meta;
  const suppliers = suppliersData?.data ?? [];

  const hasFilters =
    Boolean(q || supplierId || status || dateFrom || dateTo);

  const clearFilters = () => {
    setPage(1);
    setQ("");
    setSupplierId("");
    setStatus("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 lg:min-h-[calc(100vh-4rem)] lg:gap-5">
        {/* Page Header */}
<PageHeader
          title="Órdenes de compra"
          subtitle="Gestiona las compras, recepción de mercancía y abastecimiento"
          count={
            meta
              ? `${meta.total} ${meta.total === 1 ? "orden" : "órdenes"}`
              : undefined
          }
          actions={
            canManage ? (
              <Link href="/purchase-orders/new" className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto">
                  <Plus className="w-4 h-4" /> Nueva OC
                </Button>
              </Link>
            ) : undefined
          }
        />

        {/* Filter Bar */}
        <FilterBar
          searchValue={q}
          onSearchChange={(value) => {
            setPage(1);
            setQ(value);
          }}
          searchPlaceholder="Buscar por N° OC o proveedor..."
          filterControls={
            <>
              <BentoSelect
                value={supplierId}
                onChange={(value) => {
                  setPage(1);
                  setSupplierId(value);
                }}
                className="w-full sm:w-52"
                placeholder="Todos los proveedores"
                options={[
                  { value: "", label: "Todos los proveedores" },
                  ...suppliers.map((s) => ({
                    value: s.id,
                    label: s.name,
                  })),
                ]}
              />
              <BentoSelect
                value={status}
                onChange={(value) => {
                  setPage(1);
                  setStatus(value as "" | PurchaseOrderStatus);
                }}
                className="w-full sm:w-44"
                placeholder="Todos los estados"
                options={statusOptions.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
              />
              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setPage(1);
                    setDateFrom(e.target.value);
                  }}
                  className="h-[38px] px-2.5 rounded-lg text-xs bg-muted/40 border border-transparent focus:border-border/70 focus:bg-background text-foreground transition-colors font-mono tabular-nums flex-1 sm:flex-none"
                  aria-label="Fecha inicial"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setPage(1);
                    setDateTo(e.target.value);
                  }}
                  className="h-[38px] px-2.5 rounded-lg text-xs bg-muted/40 border border-transparent focus:border-border/70 focus:bg-background text-foreground transition-colors font-mono tabular-nums flex-1 sm:flex-none"
                  aria-label="Fecha final"
                />
              </div>

              {hasFilters && <FilterClearButton onClick={clearFilters} />}

              <ViewModeToggle
                value={viewMode}
                onChange={(mode) => {
                  setPage(1);
                  setViewMode(mode);
                }}
              />
            </>
          }
        />

        {/* Content */}
        {isLoading ? (
          <TableSkeleton columns={6} rows={6} label="Cargando órdenes de compra..." />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="w-5 h-5 text-muted-foreground" />}
            title={
              hasFilters
                ? "Sin resultados para los filtros aplicados"
                : "No hay órdenes de compra registradas"
            }
            subtitle={
              hasFilters
                ? "Prueba cambiando el rango de fechas, proveedor o estado."
                : "Crea tu primera orden de compra para abastecer inventario."
            }
          />
        ) : (
          <>
            {viewMode === "table" ? (
              <div className="w-full rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden animate-fade-in flex-1">
                <div className="overflow-x-auto">
                  <Table className="min-w-[680px]">
                    <TableHeader>
                      <TableRow>
                        <TableCell as="th">N° OC</TableCell>
                        <TableCell as="th">Proveedor</TableCell>
                        <TableCell as="th">Fecha</TableCell>
                        <TableCell as="th">Estado</TableCell>
                        <TableCell as="th" className="text-right">
                          Total
                        </TableCell>
                        <TableCell as="th" className="text-right">
                          Acciones
                        </TableCell>
                      </TableRow>
                    </TableHeader>
                    <tbody>
                      {orders.map((order) => (
                        <TableRow
                          key={order.id}
                          className="cursor-pointer"
                          onClick={() =>
                            router.push(`/purchase-orders/${order.id}`)
                          }
                        >
                          <TableCell>
                            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                              OC-{order.orderNumber}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[240px]">
                            <span className="text-xs font-medium text-foreground line-clamp-1">
                              {order.supplier?.name ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                              {formatDate(order.createdAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <PurchaseOrderStatusBadge status={order.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                              {formatCurrency(order.total)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div
                              className="inline-flex items-center justify-end"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  router.push(`/purchase-orders/${order.id}`)
                                }
                                className="h-7 px-2.5 text-xs inline-flex items-center gap-1.5"
                              >
                                <Eye className="w-3.5 h-3.5" /> Detalle
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="grid flex-1 content-start grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 lg:gap-4 stagger-children">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="group flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border cursor-pointer"
                    onClick={() => router.push(`/purchase-orders/${order.id}`)}
                  >
                    <div>
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <span className="font-mono text-xs font-semibold text-foreground tracking-tight tabular-nums">
                          OC-{order.orderNumber}
                        </span>
                        <PurchaseOrderStatusBadge status={order.status} />
                      </div>

                      {/* Supplier and Date */}
                      <div className="space-y-1.5 mt-3 pt-2.5 border-t border-border/50 text-xs">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Truck className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
                          <span className="font-semibold text-foreground truncate">
                            {order.supplier?.name ?? "Sin proveedor"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {formatDate(order.createdAt)}
                          </span>
                        </div>
                        {order.notes && (
                          <p className="text-xs text-muted-foreground/70 line-clamp-1 pt-0.5">
                            {order.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-3 mt-3.5 border-t border-border/60">
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground">
                          Total compra
                        </p>
                        <p className="font-mono text-sm font-semibold text-foreground tabular-nums">
                          {formatCurrency(order.total)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/purchase-orders/${order.id}`);
                        }}
                        className="h-7 px-2.5 text-xs inline-flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" /> Detalle
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {meta && (
              <Pagination
                currentPage={page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                totalItems={meta.total}
                itemLabel="orden"
              />
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
