"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useSuppliers } from "@/hooks/useSuppliers";
import { Button, buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { PurchaseOrderStatusBadge } from "@/components/purchase-orders/PurchaseOrderStatusBadge";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { FilterBar, FilterClearButton } from "@/components/ui/FilterBar";
import { Select } from "@/components/ui/Select";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { COLLECTION_GRID_CLASSES } from "@/components/ui/collectionGrid";
import { useEffectiveViewMode } from "@/hooks/useEffectiveViewMode";
import { useResponsivePageSize } from "@/hooks/useResponsivePageSize";
import {
  COLLECTION_CARD_FALLBACK_ROW_HEIGHT,
  COLLECTION_CARD_MIN_WIDTH,
  COLLECTION_GRID_GAP,
  MAX_COLLECTION_PAGE_SIZE,
  MIN_VISIBLE_ROWS,
  remapPageForPageSize,
} from "@/lib/collection-grid";
import {
  Plus,
  Eye,
  ClipboardList,
  Truck,
  Calendar,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { hasAnyRole } from "@/lib/auth";
import type { PurchaseOrderStatusFilter } from "@/types";
import { useAuth } from "@/contexts/AuthContext";

const statusOptions: Array<{ value: "" | PurchaseOrderStatusFilter; label: string }> = [
  { value: "", label: "Todos los estados" },
  { value: "OPEN", label: "Por recibir" },
  { value: "OVERDUE", label: "Atrasadas" },
  { value: "DRAFT", label: "Borrador" },
  { value: "PENDING", label: "Pendiente" },
  { value: "PARTIAL_RECEIVED", label: "Recibida parcialmente" },
  { value: "RECEIVED", label: "Recibida" },
  { value: "CANCELLED", label: "Cancelada" },
];

/** Table view: a dense list keeps the page it always had. */
const TABLE_PAGE_SIZE = 10;

/**
 * A link may open the list already filtered (`?status=OPEN` from the daily
 * report). Only a status the select offers is honoured; anything else lists
 * every order, as before.
 */
function statusFromUrl(value: string | null | undefined): "" | PurchaseOrderStatusFilter {
  const match = statusOptions.find((option) => option.value !== "" && option.value === value);
  return match ? match.value : "";
}

function PurchaseOrdersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const canManage = hasAnyRole(user?.role, ["ADMIN", "INVENTORY_USER"]);

  const [q, setQ] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<"" | PurchaseOrderStatusFilter>(() =>
    statusFromUrl(searchParams?.get("status")),
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useEffectiveViewMode("purchase-orders");

  // Card view fills the viewport: the grid reports how many cards fit, and the
  // table keeps the fixed page it always had.
  const {
    pageSize: gridPageSize,
    containerRef: gridRef,
    footerRef,
  } = useResponsivePageSize({
    minCardWidth: COLLECTION_CARD_MIN_WIDTH,
    gap: COLLECTION_GRID_GAP,
    rowHeight: COLLECTION_CARD_FALLBACK_ROW_HEIGHT,
    minRows: MIN_VISIBLE_ROWS,
    min: TABLE_PAGE_SIZE,
    max: MAX_COLLECTION_PAGE_SIZE,
    enabled: viewMode === "grid",
  });
  const pageSize = viewMode === "grid" ? gridPageSize : TABLE_PAGE_SIZE;

  // Re-anchor on the item the user was already looking at when a resize changes
  // the page size, instead of leaving them on a page that now starts elsewhere.
  const previousPageSize = useRef(pageSize);
  useEffect(() => {
    const previous = previousPageSize.current;
    if (previous === pageSize) return;
    previousPageSize.current = pageSize;
    const nextPage = remapPageForPageSize({ page, previousSize: previous, nextSize: pageSize });
    if (nextPage !== page) setPage(nextPage);
  }, [pageSize, page]);

  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const { data, isLoading, isError, refetch } = usePurchaseOrders({
    page,
    limit: pageSize,
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
      <div className="flex flex-1 flex-col gap-4 lg:gap-5">
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
              <Link
                href="/purchase-orders/new"
                className={buttonClassName({ className: "w-full sm:w-auto" })}
              >
                <Plus className="w-4 h-4" /> Nueva orden
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
          searchPlaceholder="Buscar por número de orden o proveedor…"
          filterControls={
            <>
              <Select
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
              <Select
                value={status}
                onChange={(value) => {
                  setPage(1);
                  setStatus(value as "" | PurchaseOrderStatusFilter);
                }}
                className="w-full sm:w-44"
                placeholder="Todos los estados"
                options={statusOptions.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
              />
              {/* Two equal tracks on phones so neither date can push past the card edge. */}
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-1.5">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setPage(1);
                    setDateFrom(e.target.value);
                  }}
                  className="min-w-0 w-full sm:w-40"
                  aria-label="Fecha inicial"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setPage(1);
                    setDateTo(e.target.value);
                  }}
                  className="min-w-0 w-full sm:w-40"
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
          <TableSkeleton columns={6} rows={6} label="Cargando órdenes de compra…" />
        ) : isError && !data ? (
          <ErrorState
            message="No se pudieron cargar las órdenes de compra."
            retryLabel="Reintentar"
            onRetry={() => void refetch()}
          />
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
              <div className="w-full rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden flex-1">
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
                          className="cursor-pointer active:bg-muted/40"
                          onClick={() =>
                            router.push(`/purchase-orders/${order.id}`)
                          }
                        >
                          <TableCell>
                            <span className="text-xs font-semibold text-foreground tabular-nums">
                              OC-{order.orderNumber}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[240px]">
                            <span className="text-xs font-medium text-foreground line-clamp-1">
                              {order.supplier?.name ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                              {formatDate(order.createdAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <PurchaseOrderStatusBadge
                              status={order.status}
                              sent={Boolean(order.sentAt)}
                              overdue={Boolean(order.overdue)}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs font-semibold text-foreground tabular-nums">
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
                                className="px-2.5 gap-1.5"
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
              <div ref={gridRef} className={cn(COLLECTION_GRID_CLASSES, "flex-1 content-start")}>
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="group flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border active:bg-muted/60 cursor-pointer"
                    onClick={() => router.push(`/purchase-orders/${order.id}`)}
                  >
                    <div>
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <span className="text-xs font-semibold text-foreground tracking-tight tabular-nums">
                          OC-{order.orderNumber}
                        </span>
                        <PurchaseOrderStatusBadge
                          status={order.status}
                          sent={Boolean(order.sentAt)}
                          overdue={Boolean(order.overdue)}
                        />
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
                          <span className="tabular-nums text-muted-foreground">
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
                        <p className="text-sm font-semibold text-foreground tabular-nums">
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
                        className="px-2.5 gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" /> Detalle
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {meta && (
              // `contents` keeps the pager a direct flex child (sticky bottom and
              // mt-auto still work) while the sizing hook measures it.
              <div ref={footerRef} className="contents">
                <Pagination
                  currentPage={page}
                  totalPages={meta.totalPages}
                  onPageChange={setPage}
                  totalItems={meta.total}
                  pageSize={pageSize}
                  itemLabel="orden"
                  itemLabelPlural="órdenes"
                />
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <Suspense
      fallback={<TableSkeleton rows={6} columns={6} label="Cargando órdenes de compra…" />}
    >
      <PurchaseOrdersContent />
    </Suspense>
  );
}
