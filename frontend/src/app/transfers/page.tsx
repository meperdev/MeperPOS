"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Eye, Plus, XCircle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { CollectionSkeleton } from "@/components/ui/CollectionSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterClearButton, FilterGroup, FilterOptionButton } from "@/components/ui/FilterBar";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import type { RowActionItem } from "@/components/ui/RowActions";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import {
  COLLECTION_CONTENT_ENTER_CLASSES,
  COLLECTION_GRID_CLASSES,
  COLLECTION_PENDING_CLASSES,
  COLLECTION_PENDING_OPACITY_CLASS,
} from "@/components/ui/collectionGrid";
import { TransferCard, TransferRoute } from "@/components/transfers/TransferCard";
import { TransferStatusBadge } from "@/components/transfers/TransferStatusBadge";
import { NewTransferModal } from "@/components/transfers/NewTransferModal";
import { TransferDetailModal } from "@/components/transfers/TransferDetailModal";
import { CancelTransferModal } from "@/components/transfers/CancelTransferModal";
import { useEffectiveViewMode } from "@/hooks/useEffectiveViewMode";
import { useDeferredLoading } from "@/hooks/useDeferredLoading";
import { useResponsivePageSize } from "@/hooks/useResponsivePageSize";
import { useLocations } from "@/hooks/useLocations";
import { useTransferSummary, useTransfers } from "@/hooks/useTransfers";
import { useAuth } from "@/contexts/AuthContext";
import { hasAnyRole } from "@/lib/auth";
import { activationProps } from "@/lib/activation";
import {
  COLLECTION_CARD_FALLBACK_ROW_HEIGHT,
  COLLECTION_CARD_MIN_WIDTH,
  COLLECTION_GRID_GAP,
  MAX_COLLECTION_PAGE_SIZE,
  MIN_VISIBLE_ROWS,
  remapPageForPageSize,
} from "@/lib/collection-grid";
import { cn, formatDateTime } from "@/lib/utils";
import type { StockTransfer, StockTransferStatus } from "@/types";

/** Table view: a dense list keeps the page it always had. */
const TABLE_PAGE_SIZE = 10;

/**
 * Only three states exist, so the filter reads as one segmented row rather than
 * a select that opens a list of three. The wording of each chip is plural: it
 * selects a set of documents.
 */
const STATUS_FILTERS: Array<{ value: "" | StockTransferStatus; label: string }> = [
  { value: "", label: "Todas" },
  { value: "IN_TRANSIT", label: "En tránsito" },
  { value: "RECEIVED", label: "Recibidas" },
  { value: "CANCELLED", label: "Canceladas" },
];

/**
 * Transfers between sites (S2): stock leaves an authorized origin site, stays
 * in transit, and lands at its destination when the receiving site confirms it.
 * The screen only dispatches and resolves documents; every quantity and total is
 * the server's.
 *
 * S6 splits the screen by role: an administrator or member dispatches and
 * cancels, while the destination's cashier reads what is coming and receives it.
 * This is display only — each route is guarded again on the server, and the
 * assignment that decides *which* store a cashier receives at lives there too.
 *
 * A platform super admin is not a tenant role: `/transfers` answers SUPER_ADMIN
 * on the server, so the session's `isSuperAdmin` admits dispatch even when its
 * user object carries no org role of its own.
 */
export default function TransfersPage() {
  const { user } = useAuth();
  const canDispatch =
    hasAnyRole(user?.role, ["ADMIN"]) || user?.isSuperAdmin === true;

  const [status, setStatus] = useState<"" | StockTransferStatus>("");
  const [siteId, setSiteId] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useEffectiveViewMode("transfers");

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [selected, setSelected] = useState<StockTransfer | null>(null);
  const [cancelTarget, setCancelTarget] = useState<StockTransfer | null>(null);

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

  const sites = useLocations();
  const { data, isLoading, isFetching, isError, refetch } = useTransfers({
    page,
    limit: pageSize,
    status: status || undefined,
    siteId: siteId || undefined,
  });
  // The band counts the whole scope, not the page on screen: one server total
  // per state, read from the same endpoint the list uses.
  const summary = useTransferSummary(siteId || undefined);
  // Only the first load paints a skeleton, and only after a short grace period.
  const showSkeleton = useDeferredLoading(isLoading);

  const transfers = data?.data ?? [];
  const meta = data?.meta;
  const hasFilters = Boolean(status || siteId);

  const siteOptions: SelectOption[] = [
    { value: "", label: "Todas las sedes" },
    ...(sites.data ?? []).map((site) => ({
      value: site.id,
      label: site.name,
    })),
  ];

  const clearFilters = () => {
    setPage(1);
    setStatus("");
    setSiteId("");
  };

  const openDetail = (transfer: StockTransfer) => setSelected(transfer);

  // Cancellation is administrative and only an in-transit document can still be
  // cancelled; reception stays on the document itself, where the stock lands.
  const rowActions = (transfer: StockTransfer): RowActionItem[] => {
    const items: RowActionItem[] = [
      {
        label: "Ver detalle",
        icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />,
        onSelect: () => openDetail(transfer),
      },
    ];
    if (canDispatch && transfer.status === "IN_TRANSIT") {
      items.push(
        { kind: "separator" },
        {
          label: "Cancelar transferencia",
          icon: <XCircle className="h-3.5 w-3.5" aria-hidden="true" />,
          destructive: true,
          onSelect: () => setCancelTarget(transfer),
        },
      );
    }
    return items;
  };

  const count = (value: number | undefined) =>
    value === undefined ? "—" : value.toLocaleString("es-CO");

  return (
    <DashboardLayout>
      <div className="flex flex-1 flex-col gap-4 lg:gap-5">
        <PageHeader
          title="Transferencias"
          subtitle="Mueve stock entre tus sedes sin vender ni comprar."
          count={
            meta
              ? `${meta.total} ${meta.total === 1 ? "transferencia" : "transferencias"}`
              : undefined
          }
          actions={
            canDispatch ? (
              <Button
                onClick={() => setIsNewOpen(true)}
                className="w-full sm:w-auto"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nueva transferencia
              </Button>
            ) : undefined
          }
        />

        {/* What the current site scope holds in each state. The counts come from
            the server, so a page that is filtered never reports its own slice. */}
        <div
          data-testid="transfer-summary"
          className="grid grid-cols-3 gap-2 sm:gap-3"
        >
          <MetricCard
            label="En tránsito"
            value={count(summary.data?.inTransit)}
            helper="Por recibir"
          />
          <MetricCard
            label="Recibidas"
            value={count(summary.data?.received)}
            helper="En destino"
          />
          <MetricCard
            label="Canceladas"
            value={count(summary.data?.cancelled)}
            helper="Al origen"
          />
        </div>

        {/* Filter bar. The list endpoint has no text search, so the standard
            shell carries the two filters it can actually apply — state and site
            — plus the layout switch; a search field here would filter only the
            page on screen and lie about the rest. */}
        <div className="@container rounded-xl border border-border/70 bg-card p-2 shadow-2xs">
          <div className="flex flex-wrap items-center gap-2">
            <FilterGroup label="Estado">
              {STATUS_FILTERS.map((option) => (
                <FilterOptionButton
                  key={option.value}
                  active={status === option.value}
                  onClick={() => {
                    setPage(1);
                    setStatus(option.value);
                  }}
                >
                  {option.label}
                </FilterOptionButton>
              ))}
            </FilterGroup>

            <Select
              value={siteId}
              onChange={(value) => {
                setPage(1);
                setSiteId(value);
              }}
              className="w-full sm:w-52"
              placeholder="Todas las sedes"
              options={siteOptions}
            />

            {hasFilters && <FilterClearButton onClick={clearFilters} />}

            <ViewModeToggle
              value={viewMode}
              onChange={(mode) => {
                setPage(1);
                setViewMode(mode);
              }}
            />
          </div>
        </div>

        {showSkeleton ? (
          <CollectionSkeleton
            viewMode={viewMode}
            columns={5}
            rows={6}
            label="Cargando transferencias…"
          />
        ) : isLoading ? null : isError && !data ? (
          <ErrorState
            message="No se pudieron cargar las transferencias."
            retryLabel="Reintentar"
            onRetry={() => void refetch()}
          />
        ) : transfers.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="w-5 h-5 text-muted-foreground" />}
            title={
              hasFilters
                ? "Sin resultados para los filtros aplicados"
                : "Sin transferencias todavía"
            }
            subtitle={
              hasFilters
                ? "Prueba cambiando el estado o la sede."
                : canDispatch
                  ? "Mueve mercancía de una sede a otra desde Nueva transferencia."
                  : "Cuando otra sede te envíe mercancía, aparecerá aquí para recibirla."
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
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableCell as="th">N°</TableCell>
                        <TableCell as="th">Ruta</TableCell>
                        <TableCell as="th">Estado</TableCell>
                        <TableCell as="th" className="text-right">
                          Ítems
                        </TableCell>
                        <TableCell as="th">Fecha</TableCell>
                      </TableRow>
                    </TableHeader>
                    <tbody>
                      {transfers.map((transfer) => (
                        <TableRow
                          key={transfer.id}
                          {...activationProps(
                            () => openDetail(transfer),
                            `Ver transferencia TR-${transfer.number}`,
                          )}
                          className="cursor-pointer active:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                        >
                          <TableCell>
                            <span className="id-text text-sm font-semibold text-foreground">
                              TR-{transfer.number}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[320px]">
                            <TransferRoute transfer={transfer} />
                          </TableCell>
                          <TableCell>
                            <TransferStatusBadge status={transfer.status} />
                          </TableCell>
                          <TableCell numeric>{transfer.items.length}</TableCell>
                          <TableCell>
                            <span className="whitespace-nowrap text-sm text-muted-foreground">
                              {formatDateTime(transfer.createdAt)}
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
                {transfers.map((transfer) => (
                  <TransferCard
                    key={transfer.id}
                    transfer={transfer}
                    actions={rowActions(transfer)}
                    onOpenDetail={() => openDetail(transfer)}
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
                  itemLabel="transferencia"
                  itemLabelPlural="transferencias"
                />
              </div>
            )}
          </>
        )}
      </div>

      {canDispatch && (
        <NewTransferModal
          isOpen={isNewOpen}
          onClose={() => setIsNewOpen(false)}
          onCreated={(created) => setSelected(created)}
        />
      )}

      <TransferDetailModal
        transfer={selected}
        isOpen={selected !== null}
        canCancel={canDispatch}
        onClose={() => setSelected(null)}
        onAskCancel={(transfer) => {
          // One dialog at a time: two stacked dialogs would trap and steal focus
          // from each other. The reason dialog replaces the detail.
          setSelected(null);
          setCancelTarget(transfer);
        }}
      />

      {canDispatch && (
        <CancelTransferModal
          transferId={cancelTarget?.id ?? ""}
          transferNumber={cancelTarget?.number ?? 0}
          isOpen={cancelTarget !== null}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </DashboardLayout>
  );
}
