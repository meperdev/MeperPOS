"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  usePosSiteContext,
  type PosSite,
  type PosSiteContext,
} from "@/hooks/usePosSiteContext";

export interface PosCheckoutSite {
  name: string;
  available: boolean;
  revalidate: () => Promise<boolean>;
}

interface PosSiteGateProps {
  userId: string;
  organizationId: string;
  children: (site: PosCheckoutSite, scope: string) => ReactNode;
}

/**
 * Only the accessible principal site of an organization with exactly one site
 * may charge until per-site stock exists. A visible site is not a grant.
 */
function nominatedSite(data: PosSiteContext | undefined): PosSite | undefined {
  const location = data?.locations.length === 1 ? data.locations[0] : undefined;
  return location?.id === data?.checkoutLocationId ? location : undefined;
}

export function PosSiteGate({
  userId,
  organizationId,
  children,
}: PosSiteGateProps) {
  const context = usePosSiteContext(userId, organizationId);
  const [selectedId, setSelectedId] = useState("");

  // A refetch error can retain the last successful response. Keep that site's
  // workspace state mounted but inaccessible until the site is verified again.
  const site = context.isFetchedAfterMount
    ? nominatedSite(context.data)
    : undefined;
  const workspace =
    site &&
    children(
      {
        name: site.name,
        available: !context.isError,
        revalidate: async () => {
          const next = await context.refetch();
          return !next.isError && nominatedSite(next.data)?.id === site.id;
        },
      },
      JSON.stringify([userId, organizationId, site.id]),
    );

  if (context.isError) {
    return (
      <>
        {workspace}
        <section className="space-y-3 p-4">
          <h1 className="text-lg font-semibold">Punto de venta</h1>
          <p role="alert">
            No pudimos verificar tus sedes. No se habilitó el cobro.
          </p>
          <Button variant="secondary" onClick={() => void context.refetch()}>
            Volver a intentar
          </Button>
        </section>
      </>
    );
  }
  if (!context.data || !context.isFetchedAfterMount) {
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Consultando sedes del punto de venta
      </p>
    );
  }

  const { locations } = context.data;
  const selected =
    locations.length === 1
      ? locations[0]
      : locations.find(({ id }) => id === selectedId);

  // A site selection is not a grant. Until site stock is available, never mount
  // checkout in an organization where the server did not name its sole site.
  if (workspace) return <>{workspace}</>;

  return (
    <section className="max-w-md space-y-3 p-4">
      <h1 className="text-lg font-semibold">Punto de venta</h1>
      {locations.length > 1 && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Sede
          <select
            className="min-h-11 rounded-lg border border-border bg-card px-3 text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            value={selected?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="" disabled>
              Selecciona una sede
            </option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {locations.length === 1 && (
        <p className="text-sm font-medium">Sede: {selected?.name}</p>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {locations.length === 0
          ? "No tienes sedes asignadas"
          : selected
            ? "El cobro no está habilitado para esta sede"
            : "Selecciona una sede para consultar su disponibilidad."}
      </p>
    </section>
  );
}
