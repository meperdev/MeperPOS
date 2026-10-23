"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useSuppliers } from "@/hooks/useSuppliers";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { PurchaseOrderStatusBadge } from "@/components/purchase-orders/PurchaseOrderStatusBadge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { Plus, Eye, ClipboardList, X } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { chipStyles } from "@/lib/chipStyles";
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

  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const { data, isLoading } = usePurchaseOrders({
    page,
    limit: 15,
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
    !!q || !!supplierId || !!status || !!dateFrom || !!dateTo;

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
      <div className="space-y-5 lg:space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-1 h-7 rounded-full bg-primary shrink-0" />
              <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
                Órdenes de compra
              </h1>
              {meta && (
                <span
                  className={`hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${chipStyles.primary}`}
                >
                  {meta.total} registros
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground ml-4">
              Gestiona las compras y el abastecimiento
            </p>
          </div>
          {canManage && (
            <Link href="/purchase-orders/new" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto shrink-0">
                <Plus className="w-4 h-4" /> Nueva OC
              </Button>
            </Link>
          )}
        </div>

        <FilterBar
          searchValue={q}
          onSearchChange={(value) => {
            setPage(1);
            setQ(value);
          }}
          searchPlaceholder="Buscar por N° OC o proveedor..."
          filterControls={
            <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
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
                  className="h-8 px-2 rounded-lg text-xs font-semibold bg-muted/40 border border-border/60 text-foreground focus:outline-none focus:border-primary/50 flex-1 sm:flex-none"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setPage(1);
                    setDateTo(e.target.value);
                  }}
                  className="h-8 px-2 rounded-lg text-xs font-semibold bg-muted/40 border border-border/60 text-foreground focus:outline-none focus:border-primary/50 flex-1 sm:flex-none"
                />
              </div>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60 transition-colors"
                >
                  <X className="w-3 h-3" /> Limpiar
                </button>
              )}
            </div>
          }
        />

        {isLoading ? (
          <LoadingState icon={<ClipboardList className="w-4 h-4 text-primary/50" />} message="Cargando órdenes..." />
        ) : (
          <>
            {/* Mobile Cards View */}
            <div className="md:hidden space-y-3">
              {orders.length === 0 ? (
                <EmptyState icon={<ClipboardList className="w-6 h-6 text-muted-foreground/30" />} title="No hay órdenes de compra" />
              ) : (
                orders.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-2xl border border-accent/30 bg-card p-4 shadow-xs space-y-3 cursor-pointer active:scale-[0.99] transition-transform"
                    onClick={() => router.push(`/purchase-orders/${order.id}`)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-primary">
                        OC-{order.orderNumber}
                      </span>
                      <PurchaseOrderStatusBadge status={order.status} />
                    </div>

                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span>Proveedor</span>
                        <span className="font-semibold text-foreground truncate max-w-[180px]">
                          {order.supplier?.name ?? "—"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span>Fecha</span>
                        <span className="font-mono">{formatDate(order.createdAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Total</p>
                        <p className="stat-number text-base font-bold text-foreground">
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
                        className="h-8 px-2.5 text-xs"
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" /> Detalle
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block rounded-3xl border border-accent/30 bg-accent/10 overflow-hidden">
              <div className="overflow-x-auto">
                <Table variant="accent" className="min-w-[680px]">
                  <TableHeader>
                    <TableRow>
                      <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        N° OC
                      </TableCell>
                      <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Proveedor
                      </TableCell>
                      <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Fecha
                      </TableCell>
                      <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Estado
                      </TableCell>
                      <TableCell as="th" className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Total
                      </TableCell>
                      <TableCell as="th" className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Acciones
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {orders.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-14">
                          <EmptyState icon={<ClipboardList className="w-6 h-6 text-muted-foreground/30" />} title="No hay órdenes de compra" />
                        </td>
                      </tr>
                    ) : (
                      orders.map((order) => (
                        <TableRow
                          key={order.id}
                          className="cursor-pointer"
                          onClick={() =>
                            router.push(`/purchase-orders/${order.id}`)
                          }
                        >
                          <TableCell>
                            <span className="text-xs font-bold text-primary font-mono">
                              OC-{order.orderNumber}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            <span className="text-xs font-semibold text-foreground">
                              {order.supplier?.name ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap font-mono">
                            {formatDate(order.createdAt)}
                          </TableCell>
                          <TableCell>
                            <PurchaseOrderStatusBadge status={order.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="stat-number text-sm font-bold text-foreground">
                              {formatCurrency(order.total)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/purchase-orders/${order.id}`);
                                }}
                                className="p-1.5 h-7 w-7"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>
            </div>

            {meta && meta.totalPages > 1 && (
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
