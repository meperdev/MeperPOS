"use client";

import { useState } from "react";
import { BellRing, Package, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDateTime } from "@/lib/utils";
import {
  useAlertNotifications,
  type StockAlertEventKind,
} from "@/hooks/useAlertNotifications";

const PAGE_SIZE = 20;

const KIND_LABELS: Record<StockAlertEventKind, string> = {
  OPENED: "Abierta",
  RESOLVED: "Resuelta",
  NOTIFIED: "Enviada",
  FAILED: "Fallida",
  SKIPPED: "Omitida",
};

const KIND_TONES: Record<
  StockAlertEventKind,
  "primary" | "success" | "warning" | "danger" | "default"
> = {
  OPENED: "primary",
  RESOLVED: "success",
  NOTIFIED: "success",
  FAILED: "danger",
  SKIPPED: "warning",
};

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
          title="Historial de notificaciones"
          subtitle="Cada episodio de stock bajo y el resultado de su aviso por WhatsApp."
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
          <LoadingState
            icon={<BellRing className="h-4 w-4" />}
            message="Cargando historial…"
          />
        ) : history.isError && !history.data ? (
          <ErrorState
            message="No se pudo cargar el historial de notificaciones."
            retryLabel="Reintentar"
            onRetry={() => void history.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Package className="h-4 w-4" />}
            title="Sin notificaciones todavía"
            subtitle="Cuando un producto llegue a su mínimo vas a ver el episodio acá."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
            <ul className="divide-y divide-border/60">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 px-3.5 py-3"
                >
                  <Badge variant={KIND_TONES[item.kind]} className="shrink-0">
                    {KIND_LABELS[item.kind]}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {item.product.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {item.product.sku} · episodio {item.episode}
                      {item.failureReason ? ` · ${item.failureReason}` : ""}
                    </p>
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {formatDateTime(item.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {meta ? (
          <Pagination
            currentPage={meta.page}
            totalPages={meta.totalPages}
            totalItems={meta.total}
            pageSize={meta.limit}
            itemLabel="notificación"
            itemLabelPlural="notificaciones"
            onPageChange={setPage}
          />
        ) : null}
      </div>
    </DashboardLayout>
  );
}
