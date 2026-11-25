"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import {
  useLocations,
  useReplaceLocationAssignments,
  useUserLocationAssignments,
} from "@/hooks/useLocations";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import type { LocationSite, LocationType } from "@/types";

const TYPE_LABEL: Record<LocationType, string> = {
  STORE: "Sucursal",
  WAREHOUSE: "Bodega",
};

interface SiteAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The membership being granted access; owners and admins reach every site. */
  user: { id: string; name: string } | null;
}

/**
 * Per-person site access: which of the organization's sites one restricted
 * membership may operate. The checkboxes are the exact assignment set the API
 * stores, so an unchecked site is a site this person cannot reach.
 *
 * The server answers whether the membership already reaches every site
 * (`orgWideAccess`), because the user list this dialog opens from does not carry
 * roles.
 */
export function SiteAssignmentModal({
  isOpen,
  onClose,
  user,
}: SiteAssignmentModalProps) {
  const toast = useToast();
  const sites = useLocations();
  const assignments = useUserLocationAssignments(isOpen && user ? user.id : null);
  const replaceAssignments = useReplaceLocationAssignments();

  const orgWideAccess = assignments.data?.orgWideAccess === true;
  const isSettling = sites.isLoading || assignments.isLoading;
  const failed = (sites.isError && !sites.data) || assignments.isError;

  /**
   * Edits in progress, one entry per person. The dialog shows the server's
   * assignments until someone touches a checkbox, so no effect has to copy the
   * query result into state; closing drops the draft and the next open starts
   * from the server again.
   */
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const draftKey = user?.id ?? "";
  const selected = drafts[draftKey] ?? assignments.data?.locationIds ?? [];

  const close = () => {
    setDrafts((current) => {
      if (!(draftKey in current)) return current;
      const rest = { ...current };
      delete rest[draftKey];
      return rest;
    });
    onClose();
  };

  const toggle = (siteId: string) =>
    setDrafts((current) => {
      const base = current[draftKey] ?? assignments.data?.locationIds ?? [];
      return {
        ...current,
        [draftKey]: base.includes(siteId)
          ? base.filter((id) => id !== siteId)
          : [...base, siteId],
      };
    });

  const handleSave = async () => {
    if (!user) return;
    try {
      await replaceAssignments.mutateAsync({
        userId: user.id,
        locationIds: selected,
      });
      toast.success(
        selected.length === 0 ? "Acceso a sedes retirado" : "Sedes asignadas",
        { description: user.name },
      );
      close();
    } catch (error) {
      toast.error("No se pudieron asignar las sedes", {
        description: getApiErrorMessage(error, "Intenta de nuevo."),
      });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={user ? `Sedes de ${user.name}` : "Sedes"}
      size="sm"
    >
      {isSettling ? (
        <LoadingState
          icon={<Building2 aria-hidden="true" />}
          message="Cargando sedes…"
        />
      ) : failed ? (
        <ErrorState
          message="No se pudieron cargar las sedes."
          retryLabel="Reintentar"
          onRetry={() => {
            void sites.refetch();
            void assignments.refetch();
          }}
        />
      ) : orgWideAccess ? (
        <p className="text-sm text-muted-foreground">
          {user?.name} accede a todas las sedes de la organización, también a las
          que se creen después. No hace falta asignarlas una por una.
        </p>
      ) : (sites.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-4 w-4" />}
          title="Sin sedes todavía"
          subtitle="Crea la primera sede antes de asignarla."
        />
      ) : (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-[13px] font-medium text-muted-foreground">
            Sedes habilitadas para esta persona
          </legend>
          {(sites.data ?? []).map((site: LocationSite) => (
            <label
              key={site.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/70 px-3 py-2"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={selected.includes(site.id)}
                onChange={() => toggle(site.id)}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {site.name}
              </span>
              <Badge variant={site.type === "WAREHOUSE" ? "info" : "default"}>
                {TYPE_LABEL[site.type]}
              </Badge>
              {site.isDefault && <Badge variant="primary">Principal</Badge>}
            </label>
          ))}
        </fieldset>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close}>
          {orgWideAccess ? "Entendido" : "Cancelar"}
        </Button>
        {!isSettling && !failed && !orgWideAccess && (
          <Button
            type="button"
            disabled={replaceAssignments.isPending}
            onClick={() => void handleSave()}
          >
            Guardar sedes
          </Button>
        )}
      </div>
    </Modal>
  );
}
