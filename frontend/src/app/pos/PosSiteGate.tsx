"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  usePosSiteContext,
  type PosSite,
  type PosSiteContext,
} from "@/hooks/usePosSiteContext";

export interface PosCheckoutSite {
  /** The site every sale and financing of this workspace is written to. */
  id: string;
  name: string;
  available: boolean;
  revalidate: () => Promise<boolean>;
  /**
   * Opens the store picker again. Present only when the cashier can reach more
   * than one store; the page offers it only with an empty, unlocked cart,
   * because changing the site mounts a different workspace.
   */
  change?: () => void;
}

interface PosSiteGateProps {
  userId: string;
  organizationId: string;
  children: (site: PosCheckoutSite, scope: string) => ReactNode;
}

/**
 * Only a store the caller reaches may charge. The server lists the accessible
 * stores and nominates one when it is obvious (the principal store, or the only
 * reachable one); otherwise the cashier picks from that list. A nomination is
 * never a grant: the sale transaction authorizes the site again.
 */
function listedStore(
  data: PosSiteContext | undefined,
  id: string | null | undefined,
): PosSite | undefined {
  if (!id) return undefined;
  return data?.locations.find((location) => location.id === id);
}

export function PosSiteGate({
  userId,
  organizationId,
  children,
}: PosSiteGateProps) {
  const context = usePosSiteContext(userId, organizationId);
  const [selectedId, setSelectedId] = useState("");
  const [picking, setPicking] = useState(false);

  // A refetch error can retain the last successful response. Keep that site's
  // workspace state mounted but inaccessible until the site is verified again.
  const data = context.isFetchedAfterMount ? context.data : undefined;
  const locations = data?.locations ?? [];
  // The cashier's own choice wins; otherwise the server's nomination; a single
  // reachable store needs no click. Anything else waits on the picker below.
  const activeId = picking
    ? undefined
    : (listedStore(data, selectedId)?.id ??
      (listedStore(data, data?.checkoutLocationId)
        ? (data?.checkoutLocationId as string)
        : locations.length === 1
          ? locations[0].id
          : undefined));
  const active = listedStore(data, activeId);

  const workspace =
    data &&
    active &&
    children(
      {
        id: active.id,
        name: active.name,
        available: !context.isError,
        revalidate: async () => {
          const next = await context.refetch();
          return !next.isError && !!listedStore(next.data, active.id);
        },
        change:
          locations.length > 1
            ? () => {
                setSelectedId(active.id);
                setPicking(true);
              }
            : undefined,
      },
      // The cart, its paused drafts and every request of this till belong to
      // this exact site: changing it mounts a different workspace.
      JSON.stringify([userId, organizationId, active.id]),
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
  if (!data) {
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Consultando sedes del punto de venta
      </p>
    );
  }

  if (workspace) return <>{workspace}</>;

  const selected =
    listedStore(data, selectedId) ?? listedStore(data, data.checkoutLocationId);

  return (
    <section className="max-w-md space-y-3 p-4">
      <h1 className="text-lg font-semibold">Punto de venta</h1>
      {locations.length > 1 && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Sede
          <select
            className="min-h-11 rounded-lg border border-border bg-card px-3 text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            value={selected?.id ?? ""}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setPicking(false);
            }}
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
      {picking && selected && (
        <Button variant="secondary" onClick={() => setPicking(false)}>
          Seguir en {selected.name}
        </Button>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {locations.length === 0
          ? "No tienes sedes asignadas"
          : "Selecciona la sede donde vas a cobrar para empezar a vender."}
      </p>
    </section>
  );
}
