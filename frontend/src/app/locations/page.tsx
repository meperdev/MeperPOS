"use client";

import { useState } from "react";
import { Building2, Pencil, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select, type SelectOption } from "@/components/ui/Select";
import {
  useCreateLocation,
  useLocations,
  useUpdateLocation,
} from "@/hooks/useLocations";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import type { LocationSite, LocationType } from "@/types";

/** The two kinds of site S2 introduces, named the way the business names them. */
const TYPE_LABEL: Record<LocationType, string> = {
  STORE: "Sucursal",
  WAREHOUSE: "Bodega",
};

const TYPE_OPTIONS: SelectOption[] = [
  { value: "STORE", label: TYPE_LABEL.STORE },
  { value: "WAREHOUSE", label: TYPE_LABEL.WAREHOUSE },
];

const EMPTY_FORM: { name: string; type: LocationType } = {
  name: "",
  type: "STORE",
};

/**
 * Site management (S2): every store and warehouse of the organization, each one
 * labelled and editable. Creating a site grants nobody access to it (S3) — the
 * per-person assignment lives in the team screen.
 */
export default function LocationsPage() {
  const toast = useToast();
  const sites = useLocations();
  const createLocation = useCreateLocation();
  const updateLocation = useUpdateLocation();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<LocationSite | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const isPrincipal = editing?.isDefault === true;
  const isSaving = createLocation.isPending || updateLocation.isPending;
  const rows = sites.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setIsFormOpen(true);
  };

  const openEdit = (site: LocationSite) => {
    setEditing(site);
    setForm({ name: site.name, type: site.type });
    setIsFormOpen(true);
  };

  const closeForm = () => setIsFormOpen(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;

    try {
      if (editing) {
        // The principal site keeps its type: the server refuses the change and
        // the form never offers it.
        await updateLocation.mutateAsync({
          id: editing.id,
          data: isPrincipal ? { name } : { name, type: form.type },
        });
        toast.success("Sede actualizada", { description: name });
      } else {
        await createLocation.mutateAsync({ name, type: form.type });
        toast.success("Sede creada", {
          description: "Asigna el acceso a cada persona desde Usuarios.",
        });
      }
      closeForm();
    } catch (error) {
      toast.error("No se pudo guardar la sede", {
        description: getApiErrorMessage(
          error,
          "Revisa el nombre y el tipo de sede.",
        ),
      });
    }
  };

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

        {sites.isLoading ? (
          <LoadingState
            icon={<Building2 aria-hidden="true" />}
            message="Cargando sedes…"
          />
        ) : sites.isError && !sites.data ? (
          <ErrorState
            message="No se pudieron cargar las sedes."
            retryLabel="Reintentar"
            onRetry={() => void sites.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-4 w-4" />}
            title="Sin sedes todavía"
            subtitle="Crea la primera sucursal o bodega de la organización."
          />
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
            {rows.map((site) => (
              <li
                key={site.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-medium text-foreground">
                    {site.name}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={site.type === "WAREHOUSE" ? "info" : "default"}
                    >
                      {TYPE_LABEL[site.type]}
                    </Badge>
                    {site.isDefault && (
                      <Badge variant="primary">Principal</Badge>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Editar sede ${site.name}`}
                  onClick={() => openEdit(site)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editing ? "Editar sede" : "Nueva sede"}
        size="sm"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nombre"
            value={form.name}
            maxLength={80}
            required
            onChange={(event) =>
              setForm({ ...form, name: event.target.value })
            }
          />
          <Select
            label="Tipo"
            options={TYPE_OPTIONS}
            value={form.type}
            disabled={isPrincipal}
            onChange={(value) =>
              setForm({ ...form, type: value as LocationType })
            }
          />
          {isPrincipal && (
            <p className="text-[13px] text-muted-foreground">
              La sede principal opera el punto de venta, así que se mantiene
              como sucursal.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeForm}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving}>
              {editing ? "Guardar" : "Crear sede"}
            </Button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
