"use client";

import { useState } from "react";
import { ArrowLeftRight, ArrowRight, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { TransferStatusBadge } from "@/components/transfers/TransferStatusBadge";
import { NewTransferModal } from "@/components/transfers/NewTransferModal";
import { TransferDetailModal } from "@/components/transfers/TransferDetailModal";
import { CancelTransferModal } from "@/components/transfers/CancelTransferModal";
import { useLocations } from "@/hooks/useLocations";
import { useTransfers } from "@/hooks/useTransfers";
import { activationProps } from "@/lib/activation";
import { formatDateTime } from "@/lib/utils";
import type { StockTransfer, StockTransferStatus } from "@/types";

const PAGE_SIZE = 10;

const statusOptions: SelectOption[] = [
  { value: "", label: "Todos los estados" },
  { value: "IN_TRANSIT", label: "En tránsito" },
  { value: "RECEIVED", label: "Recibida" },
  { value: "CANCELLED", label: "Cancelada" },
];

/**
 * Transfers between sites (S2): stock leaves an authorized origin site, stays
 * in transit, and lands at its destination when the receiving site confirms it.
 * The screen only dispatches and resolves documents; every quantity and total is
 * the server's.
 */
export default function TransfersPage() {
  const [status, setStatus] = useState<"" | StockTransferStatus>("");
  const [siteId, setSiteId] = useState("");
  const [page, setPage] = useState(1);

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [selected, setSelected] = useState<StockTransfer | null>(null);
  const [cancelTarget, setCancelTarget] = useState<StockTransfer | null>(null);

  const sites = useLocations();
  const { data, isLoading, isError, refetch } = useTransfers({
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
    siteId: siteId || undefined,
  });

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

  const route = (transfer: StockTransfer) => (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm text-foreground">
        {transfer.fromLocation.name}
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      <span className="truncate text-sm text-foreground">
        {transfer.toLocation.name}
      </span>
    </span>
  );

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
            <Button onClick={() => setIsNewOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nueva transferencia
            </Button>
          }
        />

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card p-2 shadow-2xs">
          <Select
            value={status}
            onChange={(value) => {
              setPage(1);
              setStatus(value as "" | StockTransferStatus);
            }}
            className="w-full sm:w-48"
            placeholder="Todos los estados"
            options={statusOptions}
          />
          <Select
            value={siteId}
            onChange={(value) => {
              setPage(1);
              setSiteId(value);
            }}
            className="w-full sm:w-56"
            placeholder="Todas las sedes"
            options={siteOptions}
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          )}
        </div>

        {isLoading ? (
          <LoadingState
            icon={<ArrowLeftRight aria-hidden="true" />}
            message="Cargando transferencias…"
          />
        ) : isError && !data ? (
          <ErrorState
            message="No se pudieron cargar las transferencias."
            retryLabel="Reintentar"
            onRetry={() => void refetch()}
          />
        ) : transfers.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="h-4 w-4" />}
            title={
              hasFilters
                ? "Sin resultados para los filtros aplicados"
                : "Sin transferencias todavía"
            }
            subtitle={
              hasFilters
                ? "Prueba cambiando el estado o la sede."
                : "Mueve mercancía de una sede a otra desde Nueva transferencia."
            }
          />
        ) : (
          <>
            <div className="@container overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
              <div className="hidden @2xl:block overflow-x-auto">
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
                        <TableCell className="max-w-[320px]">{route(transfer)}</TableCell>
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

              <ul data-testid="transfer-list" className="@2xl:hidden divide-y divide-border/60">
                {transfers.map((transfer) => (
                  <li key={transfer.id}>
                    <button
                      type="button"
                      onClick={() => openDetail(transfer)}
                      aria-label={`Ver transferencia TR-${transfer.number}`}
                      className="w-full space-y-2 px-4 py-3 text-left transition-colors active:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/40"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="id-text text-sm font-semibold text-foreground">
                          TR-{transfer.number}
                        </span>
                        <TransferStatusBadge status={transfer.status} />
                      </span>
                      <span className="block min-w-0">{route(transfer)}</span>
                      <span className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
                        <span>
                          {transfer.items.length}{" "}
                          {transfer.items.length === 1 ? "ítem" : "ítems"}
                        </span>
                        <span className="tabular-nums">
                          {formatDateTime(transfer.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {meta && (
              <Pagination
                currentPage={page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                totalItems={meta.total}
                pageSize={PAGE_SIZE}
                itemLabel="transferencia"
                itemLabelPlural="transferencias"
              />
            )}
          </>
        )}
      </div>

      <NewTransferModal
        isOpen={isNewOpen}
        onClose={() => setIsNewOpen(false)}
        onCreated={(created) => setSelected(created)}
      />

      <TransferDetailModal
        transfer={selected}
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        onAskCancel={(transfer) => {
          // One dialog at a time: two stacked dialogs would trap and steal focus
          // from each other. The reason dialog replaces the detail.
          setSelected(null);
          setCancelTarget(transfer);
        }}
      />

      <CancelTransferModal
        transferId={cancelTarget?.id ?? ""}
        transferNumber={cancelTarget?.number ?? 0}
        isOpen={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
      />
    </DashboardLayout>
  );
}
