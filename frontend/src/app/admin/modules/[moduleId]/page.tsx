"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterBar } from "@/components/ui/FilterBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { useToast } from "@/contexts/ToastContext";
import {
  useModuleCatalog,
  useOrganizations,
  useUpdateOrganizationModule,
  type Organization,
} from "@/hooks/useAdmin";
import { getApiErrorMessage } from "@/lib/api";
import {
  PAGE_SIZE,
  filterOrganizations,
  paginate,
} from "../../organizations/list";
import { statusLabel, statusTone } from "../../organizations/labels";
import {
  MODULE_STATE_FILTER_OPTIONS,
  filterOrganizationsByModuleState,
  moduleState,
  type ModuleState,
  type ModuleStateFilter,
} from "../organization-module-list";

const MODULE_STATE_BADGE: Record<
  ModuleState,
  { label: string; variant: "success" | "default" | "warning" }
> = {
  enabled: { label: "Activo", variant: "success" },
  disabled: { label: "Inactivo", variant: "default" },
  unknown: { label: "No disponible", variant: "warning" },
};

function BackToModules() {
  return (
    <Link
      href="/admin/modules"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      Volver a módulos
    </Link>
  );
}

export default function ModuleDetailPage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}) {
  const { moduleId } = use(params);
  const toast = useToast();
  const catalog = useModuleCatalog();
  const organizations = useOrganizations();
  const updateModule = useUpdateOrganizationModule();

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<ModuleStateFilter>("ALL");
  const [page, setPage] = useState(1);

  const moduleDefinition = useMemo(
    () => catalog.data?.find((entry) => entry.id === moduleId),
    [catalog.data, moduleId],
  );

  const all = useMemo(() => organizations.data ?? [], [organizations.data]);

  // Search reuses the organization list normalization so name and slug match
  // accents and case the same way the organizations page does.
  const searched = useMemo(
    () =>
      filterOrganizations(all, { search, status: "ALL", plan: "ALL" }),
    [all, search],
  );

  const filtered = useMemo(
    () => filterOrganizationsByModuleState(searched, moduleId, stateFilter),
    [searched, moduleId, stateFilter],
  );

  const pageData = useMemo(() => paginate(filtered, page), [filtered, page]);

  const toggleModule = async (organization: Organization) => {
    if (!moduleDefinition) {
      return;
    }

    const state = moduleState(organization, moduleId);
    if (state === "unknown") {
      return;
    }

    const enabled = state !== "enabled";
    try {
      await updateModule.mutateAsync({
        id: organization.id,
        moduleId,
        enabled,
      });
      toast.success(
        enabled
          ? `Se activó el módulo ${moduleDefinition.name} en ${organization.name}`
          : `Se desactivó el módulo ${moduleDefinition.name} en ${organization.name}`,
      );
    } catch (error) {
      toast.error(
        getApiErrorMessage(
          error,
          `No se pudo actualizar el módulo ${moduleDefinition.name} en ${organization.name}.`,
        ),
      );
    }
  };

  if (catalog.isLoading) {
    return (
      <div className="space-y-4">
        <BackToModules />
        <TableSkeleton rows={4} columns={4} label="Cargando módulo…" />
      </div>
    );
  }

  if (catalog.isError) {
    return (
      <div className="space-y-4">
        <BackToModules />
        <ErrorState
          message="No se pudo cargar el catálogo de módulos."
          retryLabel="Reintentar"
          onRetry={() => catalog.refetch()}
        />
      </div>
    );
  }

  if (!moduleDefinition) {
    return (
      <div className="space-y-4">
        <BackToModules />
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={<Boxes className="h-4 w-4" />}
              title="Módulo no encontrado"
              subtitle="Este módulo no existe en el catálogo."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const resultCount =
    all.length === 0
      ? undefined
      : filtered.length === all.length
        ? String(all.length)
        : `${filtered.length} de ${all.length}`;

  const header = (
    <div className="space-y-3">
      <BackToModules />
      <PageHeader
        title={moduleDefinition.name}
        subtitle={moduleDefinition.description}
        count={resultCount}
      />
    </div>
  );

  if (organizations.isLoading) {
    return (
      <div className="space-y-4">
        {header}
        <TableSkeleton
          rows={6}
          columns={4}
          label="Cargando organizaciones…"
        />
      </div>
    );
  }

  if (organizations.isError) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState
          message="No se pudieron cargar las organizaciones."
          retryLabel="Reintentar"
          onRetry={() => organizations.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      {all.length > 0 && (
        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          searchPlaceholder="Buscar por nombre o slug"
          filterControls={
            <>
              <div className="w-36">
                <BentoSelect
                  value={stateFilter}
                  options={MODULE_STATE_FILTER_OPTIONS}
                  onChange={(value) => {
                    setStateFilter(value as ModuleStateFilter);
                    setPage(1);
                  }}
                />
              </div>
            </>
          }
        />
      )}

      <Card>
        <CardContent className="p-0">
          {all.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-4 w-4" />}
              title="No hay organizaciones"
              subtitle="Cuando exista una organización, podrás activar este módulo."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-4 w-4" />}
              title="Ninguna organización coincide con los filtros"
              subtitle="La búsqueda y el filtro siguen activos. Quita la búsqueda o cambia el estado para ver todas."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableCell as="th">Organización</TableCell>
                    <TableCell as="th">Estado</TableCell>
                    <TableCell as="th">Módulo</TableCell>
                    <TableCell as="th" className="text-right">
                      Acción
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {pageData.items.map((organization) => {
                    const state = moduleState(organization, moduleId);
                    const badge = MODULE_STATE_BADGE[state];
                    const actionLabel =
                      state === "enabled" ? "Desactivar" : "Activar";

                    return (
                      <TableRow key={organization.id}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-foreground">
                              {organization.name}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {organization.slug}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              statusTone[organization.status] ?? "default"
                            }
                            dot
                          >
                            {statusLabel(organization.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={badge.variant}
                            dot={state !== "unknown"}
                          >
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {state === "unknown" ? (
                            <span className="text-[11px] text-muted-foreground">
                              Sin datos del servidor
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant={
                                state === "enabled" ? "secondary" : "primary"
                              }
                              aria-label={`${actionLabel} ${moduleDefinition.name} en ${organization.name}`}
                              disabled={updateModule.isPending}
                              onClick={() => void toggleModule(organization)}
                            >
                              {actionLabel}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {filtered.length > 0 && (
        <Pagination
          currentPage={pageData.page}
          totalPages={pageData.totalPages}
          onPageChange={setPage}
          totalItems={filtered.length}
          pageSize={PAGE_SIZE}
          itemLabel="organización"
        />
      )}
    </div>
  );
}
