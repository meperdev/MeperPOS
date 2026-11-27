"use client";

import { useState } from "react";
import { Building2, Plus, Store, Warehouse } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SiteCard } from "@/components/locations/SiteCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import {
  COLLECTION_CONTENT_ENTER_CLASSES,
  COLLECTION_GRID_CLASSES,
} from "@/components/ui/collectionGrid";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLocations } from "@/hooks/useLocations";
import { cn } from "@/lib/utils";
import type { LocationSite } from "@/types";
import { SiteFormDialog } from "./SiteFormDialog";

/**
 * Site management (S2): every store and warehouse of the organization, each one
 * labelled and editable. Creating a site grants nobody access to it (S3) — the
 * per-person assignment lives in the team screen.
 */
export default function LocationsPage() {
  const sites = useLocations();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<LocationSite | null>(null);

  const rows = sites.data ?? [];
  const storeCount = rows.filter((site) => site.type === "STORE").length;
  const warehouseCount = rows.filter((site) => site.type === "WAREHOUSE").length;

  const openCreate = () => {
    setEditing(null);
    setIsFormOpen(true);
  };

  const openEdit = (site: LocationSite) => {
    setEditing(site);
    setIsFormOpen(true);
  };

  const closeForm = () => setIsFormOpen(false);

  return (
    <DashboardLayout>
      <div className="flex flex-1 flex-col gap-4 lg:gap-5">
        <PageHeader
          title="Sedes"
          subtitle="Sucursales y bodegas de la organización."
          count={
            rows.length > 0
              ? `${rows.length} ${rows.length === 1 ? "sede" : "sedes"}`
              : undefined
          }
          actions={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nueva sede
            </Button>
          }
        />

        {rows.length > 0 && (
          <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
            {storeCount > 0 && (
              <SiteCount
                icon={<Store className="h-3.5 w-3.5" aria-hidden="true" />}
                value={storeCount}
                label={storeCount === 1 ? "sucursal" : "sucursales"}
              />
            )}
            {storeCount > 0 && warehouseCount > 0 && (
              <span className="h-4 w-px bg-border/70" aria-hidden="true" />
            )}
            {warehouseCount > 0 && (
              <SiteCount
                icon={<Warehouse className="h-3.5 w-3.5" aria-hidden="true" />}
                value={warehouseCount}
                label={warehouseCount === 1 ? "bodega" : "bodegas"}
              />
            )}
          </Card>
        )}

        {sites.isLoading ? (
          <CardSkeleton
            count={6}
            label="Cargando sedes…"
            gridClassName={COLLECTION_GRID_CLASSES}
          />
        ) : sites.isError && !sites.data ? (
          <ErrorState
            message="No se pudieron cargar las sedes."
            retryLabel="Reintentar"
            onRetry={() => void sites.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-5 w-5 text-muted-foreground" />}
            title="Sin sedes todavía"
            subtitle="Crea la primera sucursal o bodega de la organización."
          />
        ) : (
          <div
            className={cn(
              COLLECTION_GRID_CLASSES,
              "content-start",
              COLLECTION_CONTENT_ENTER_CLASSES,
            )}
          >
            {rows.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                onEdit={() => openEdit(site)}
              />
            ))}
          </div>
        )}
      </div>

      {isFormOpen && <SiteFormDialog site={editing} onClose={closeForm} />}
    </DashboardLayout>
  );
}

/** One count of the quiet summary strip: glyph, tabular number, then its noun. */
function SiteCount({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <span className="text-muted-foreground/70" aria-hidden="true">
        {icon}
      </span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
      {label}
    </span>
  );
}
