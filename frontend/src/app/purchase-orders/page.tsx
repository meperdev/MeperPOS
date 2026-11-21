"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useSuppliers } from "@/hooks/useSuppliers";
import { buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { PurchaseOrderStatusBadge } from "@/components/purchase-orders/PurchaseOrderStatusBadge";
import { CollectionSkeleton, CollectionViewSkeleton } from "@/components/ui/CollectionSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { FilterBar, FilterClearButton } from "@/components/ui/FilterBar";
import { Select } from "@/components/ui/Select";
import { SettledStrip } from "@/components/ui/SettledStrip";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import {
  COLLECTION_CONTENT_ENTER_CLASSES,
  COLLECTION_GRID_CLASSES,
  COLLECTION_PENDING_CLASSES,
  COLLECTION_PENDING_OPACITY_CLASS,
} from "@/components/ui/collectionGrid";
import { useEffectiveViewMode } from "@/hooks/useEffectiveViewMode";
import { useDeferredLoading } from "@/hooks/useDeferredLoading";
import { useResponsivePageSize } from "@/hooks/useResponsivePageSize";
import { activationProps } from "@/lib/activation";
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
  ClipboardList,
  Truck,
} from "lucide-react";
import {
  cn,
  formatCalendarDay,
  formatCalendarDayShort,
  formatCurrency,
  formatDate,
  formatDateShort,
  toFiniteNumber,
} from "@/lib/utils";
import { hasAnyRole } from "@/lib/auth";
import type { PurchaseOrder, PurchaseOrderStatusFilter } from "@/types";
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

/**
 * How much of the order already arrived, read from the item quantities the list
 * payload already carries. Display only: the server owns those quantities, so
 * the percentage never travels and never feeds a stored figure.
 *
 * A draft shows no progress at all, and an order with nothing ordered has no
 * progress to state.
 */
function receptionProgress(order: PurchaseOrder): {
  ordered: number;
  received: number;
  percentage: number;
} | null {
  const items = order.items ?? [];
  const ordered = items.reduce(
    (total, item) => total + toFiniteNumber(item.qtyOrdered),
    0,
  );
  if (ordered <= 0) return null;

  const received = items.reduce(
    (total, item) => total + toFiniteNumber(item.qtyReceived),
    0,
  );
  if (order.status === "DRAFT") return { ordered, received, percentage: 0 };

  const percentage = Math.min(
    Math.max(Math.round((received / ordered) * 100), 0),
    100,
  );
  return { ordered, received, percentage };
}

/** The amounts row keeps one column per figure it actually carries. */
function amountGridColumns(count: number): string {
  if (count >= 3) return "grid-cols-3";
  if (count === 2) return "grid-cols-2";
  return "grid-cols-1";
}

/** One centered figure inside the card's amounts row. */
function AmountCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-1 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className="mt-0.5 truncate text-sm font-semibold text-foreground tabular-nums"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * One purchase order as a scannable card: the supplier and its number up top,
 * how much of it already arrived, the money and volume figures, and the dates
 * that make the order legible without opening it.
 */
function PurchaseOrderCard({
  order,
  onOpen,
}: {
  order: PurchaseOrder;
  onOpen: () => void;
}) {
  const progress = receptionProgress(order);
  // Fully received: the status says so, or the quantities do before the status
  // has caught up. Either way the bar has nothing left to say. A draft keeps
  // its grey bar, as it has nothing received to report.
  const fullyReceived =
    progress !== null &&
    order.status !== "DRAFT" &&
    (order.status === "RECEIVED" ||
      (progress.received > 0 && progress.received >= progress.ordered));
  const overdue = Boolean(order.overdue);
  // The footer cells are half-width, so each reads the compact day and keeps the
  // prose wording reachable in its `title`. `expectedDeliveryDate` is a calendar
  // day (`@db.Date`) while `createdAt` and `sentAt` are instants, and the two
  // read through different formatters.
  const createdLabel = formatDateShort(order.createdAt);
  const createdLabelLong = formatDate(order.createdAt);
  const deliveryLabel = order.expectedDeliveryDate ? "Entrega" : "Enviada";
  const deliveryValue = order.expectedDeliveryDate
    ? formatCalendarDayShort(order.expectedDeliveryDate)
    : order.sentAt
      ? formatDateShort(order.sentAt)
      : null;
  const deliveryValueLong = order.expectedDeliveryDate
    ? formatCalendarDay(order.expectedDeliveryDate)
    : order.sentAt
      ? formatDate(order.sentAt)
      : null;

  const amounts = [
    {
      label: "Total compra",
      value: formatCurrency(toFiniteNumber(order.total)),
    },
    ...(order.items
      ? [
          {
            label: "Productos",
            value: order.items.length.toLocaleString("es-CO"),
          },
        ]
      : []),
    ...(progress
      ? [
          {
            label: "Unidades",
            value: progress.ordered.toLocaleString("es-CO"),
          },
        ]
      : []),
  ];

  return (
    <div
      {...activationProps(onOpen, `Ver orden OC-${order.orderNumber}`)}
      className="group flex h-full cursor-pointer flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background active:bg-muted/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/50 text-muted-foreground">
            <Truck className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              {order.supplier?.name ?? "Sin proveedor"}
            </p>
            <p className="id-text mt-0.5 text-[13px] text-muted-foreground">
              OC-{order.orderNumber}
            </p>
          </div>
        </div>
        <PurchaseOrderStatusBadge
          status={order.status}
          sent={Boolean(order.sentAt)}
          overdue={overdue}
        />
      </div>

      {/* Received against ordered; the bar reads at a glance what the numbers
          of the amounts row then state exactly. A fully received order replaces
          it with the shared settled strip at the same height. */}
      {progress &&
        (fullyReceived ? (
          <SettledStrip
            testId="po-settled-line"
            label="Recibida completa"
            date={order.receivedAt ? formatDateShort(order.receivedAt) : null}
          />
        ) : (
          <div>
            <div
              role="progressbar"
              aria-label="Recibido"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percentage}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                data-testid="po-progress-fill"
                className={cn(
                  "h-full rounded-full",
                  order.status === "DRAFT"
                    ? "bg-muted-foreground/30"
                    : "bg-primary",
                )}
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                Recibido {progress.percentage}%
              </span>
              <span className="truncate text-xs font-semibold text-foreground tabular-nums">
                {progress.received} de {progress.ordered} und.
              </span>
            </div>
          </div>
        ))}

      <div
        className={cn(
          "grid divide-x divide-border/60",
          amountGridColumns(amounts.length),
        )}
      >
        {amounts.map((cell) => (
          <AmountCell key={cell.label} label={cell.label} value={cell.value} />
        ))}
      </div>

      <div className="mt-auto border-t border-border/60 pt-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Creada</dt>
            <dd
              className="mt-0.5 truncate text-xs font-medium text-foreground"
              title={createdLabelLong}
            >
              {createdLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
              {deliveryLabel}
              {overdue && (
                <span className="font-semibold text-danger-text">Vencida</span>
              )}
            </dt>
            <dd
              className={cn(
                "mt-0.5 truncate text-xs font-medium",
                overdue ? "text-danger-text" : "text-foreground",
              )}
              title={deliveryValueLong ?? undefined}
            >
              {deliveryValue ?? "—"}
            </dd>
          </div>
        </dl>
        {order.notes && (
          <p
            className="mt-1.5 min-w-0 truncate text-xs text-muted-foreground"
            title={order.notes}
          >
            {order.notes}
          </p>
        )}
      </div>
    </div>
  );
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
    tableRef,
  } = useResponsivePageSize({
    minCardWidth: COLLECTION_CARD_MIN_WIDTH,
    gap: COLLECTION_GRID_GAP,
    rowHeight: COLLECTION_CARD_FALLBACK_ROW_HEIGHT,
    minRows: MIN_VISIBLE_ROWS,
    min: TABLE_PAGE_SIZE,
    max: MAX_COLLECTION_PAGE_SIZE,
    enabled: viewMode === "grid",
  });
  const pageSize = gridPageSize;

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
  const { data, isLoading, isFetching, isError, refetch } = usePurchaseOrders({
    page,
    limit: pageSize,
    q: q.trim() || undefined,
    supplierId: supplierId || undefined,
    status: status || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  // Only the first load paints a skeleton, and only after a short grace period.
  const showSkeleton = useDeferredLoading(isLoading);

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
        {showSkeleton ? (
          <CollectionSkeleton
            viewMode={viewMode}
            columns={6}
            rows={6}
            label="Cargando órdenes de compra…"
          />
        ) : isLoading ? null : isError && !data ? (
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
              <div
                className={cn(
                  "w-full rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden flex-1",
                  COLLECTION_CONTENT_ENTER_CLASSES,
                  COLLECTION_PENDING_CLASSES,
                  isFetching && COLLECTION_PENDING_OPACITY_CLASS,
                )}
              >
                <div ref={tableRef} className="overflow-x-auto">
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
                      </TableRow>
                    </TableHeader>
                    <tbody>
                      {orders.map((order) => (
                        <TableRow
                          key={order.id}
                          {...activationProps(
                            () => router.push(`/purchase-orders/${order.id}`),
                            `Ver orden OC-${order.orderNumber}`,
                          )}
                          className="cursor-pointer active:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                        >
                          <TableCell>
                            <span className="text-sm font-semibold text-foreground tabular-nums">
                              OC-{order.orderNumber}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[240px]">
                            <span className="text-sm font-medium text-foreground line-clamp-1">
                              {order.supplier?.name ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground whitespace-nowrap">
                              {formatDateShort(order.createdAt)}
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
                            <span className="text-sm font-semibold text-foreground tabular-nums">
                              {formatCurrency(order.total)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
            ) : (
              <div
                ref={gridRef}
                aria-busy={isFetching}
                className={cn(
                  COLLECTION_GRID_CLASSES,
                  "flex-1 content-start",
                  COLLECTION_CONTENT_ENTER_CLASSES,
                  COLLECTION_PENDING_CLASSES,
                  isFetching && COLLECTION_PENDING_OPACITY_CLASS,
                )}
              >
                {orders.map((order) => (
                  <PurchaseOrderCard
                    key={order.id}
                    order={order}
                    onOpen={() => router.push(`/purchase-orders/${order.id}`)}
                  />
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
      fallback={
        <DashboardLayout>
          <CollectionViewSkeleton
            storageKey="purchase-orders"
            columns={6}
            label="Cargando órdenes de compra…"
          />
        </DashboardLayout>
      }
    >
      <PurchaseOrdersContent />
    </Suspense>
  );
}
