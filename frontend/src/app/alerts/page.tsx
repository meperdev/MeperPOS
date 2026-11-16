"use client";

import { useState } from "react";
import { BellRing, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertHistoryList } from "@/components/alerts/AlertHistoryList";
import {
  useAlertNotifications,
  type StockAlertEventKind,
} from "@/hooks/useAlertNotifications";

const PAGE_SIZE = 20;

/**
 * The `kind` values the endpoint accepts. They are the only filters the history
 * supports server-side, so they are the only ones the page offers: a client-side
 * filter over one page would hide rows that exist on another.
 */
const FILTERS: Array<{ value: StockAlertEventKind | "ALL"; label: string }> = [
  { value: "ALL", label: "Todas" },
  { value: "OPENED", label: "Abiertas" },
  { value: "RESOLVED", label: "Resueltas" },
  { value: "NOTIFIED", label: "Enviadas" },
  { value: "FAILED", label: "Fallidas" },
  { value: "SKIPPED", label: "Omitidas" },
];

export default function AlertHistoryPage() {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<StockAlertEventKind | "ALL">("ALL");

  const history = useAlertNotifications({
    page,
    limit: PAGE_SIZE,
    ...(kind === "ALL" ? {} : { kind }),
  });

  const items = history.data?.data ?? [];
  const meta = history.data?.meta;

  return (
    <DashboardLayout>
      <div className="flex flex-1 flex-col gap-4 lg:gap-5">
        <PageHeader
          title="Historial de alertas"
          subtitle="Cada episodio de stock bajo y el resultado de su aviso por WhatsApp."
          count={
            meta
              ? `${meta.total} ${meta.total === 1 ? "evento" : "eventos"}`
              : undefined
          }
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void history.refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Actualizar
            </Button>
          }
        />

        <div className="rounded-xl border border-border/70 bg-card p-2 shadow-2xs">
          <FilterGroup label="Estado">
            {FILTERS.map((filter) => (
              <FilterOptionButton
                key={filter.value}
                active={kind === filter.value}
                onClick={() => {
                  setKind(filter.value);
                  setPage(1);
                }}
              >
                {filter.label}
              </FilterOptionButton>
            ))}
          </FilterGroup>
        </div>

        {history.isLoading ? (
          <div aria-busy="true">
            <TableSkeleton
              rows={6}
              columns={3}
              label="Cargando historial…"
            />
          </div>
        ) : history.isError && !history.data ? (
          <ErrorState
            message="No se pudo cargar el historial de notificaciones."
            retryLabel="Reintentar"
            onRetry={() => void history.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BellRing className="h-4 w-4" />}
            title="Sin notificaciones todavía"
            subtitle="Cuando un producto llegue a su mínimo vas a ver el episodio acá."
          />
        ) : (
          <AlertHistoryList items={items} />
        )}

        {meta ? (
          <Pagination
            currentPage={meta.page}
            totalPages={meta.totalPages}
            totalItems={meta.total}
            pageSize={meta.limit}
            itemLabel="evento"
            onPageChange={setPage}
          />
        ) : null}
      </div>
    </DashboardLayout>
  );
}
