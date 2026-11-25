"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, Store } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { SitePicker } from "@/components/pos/SitePicker";
import {
  usePosSiteContext,
  type PosSite,
  type PosSiteContext,
} from "@/hooks/usePosSiteContext";
import { cn } from "@/lib/utils";

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

/**
 * The gate's non-workspace states are screens, not leftovers: the cashier lands
 * on one instead of the till, so each carries the page title and centers itself
 * in the content box the shell hands down.
 */
function GateScreen({
  children,
  width = "max-w-md",
}: {
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center py-10 sm:py-14">
      <h1 className="sr-only">Punto de venta</h1>
      <div className={cn("w-full", width)}>{children}</div>
    </div>
  );
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
        <GateScreen>
          <ErrorState
            title="No pudimos verificar tus sedes"
            message="No se habilitó el cobro. Revisa la conexión y vuelve a intentar."
            retryLabel="Volver a intentar"
            onRetry={() => void context.refetch()}
          />
        </GateScreen>
      </>
    );
  }
  if (!data) {
    return (
      <GateScreen width="max-w-sm">
        <div role="status">
          <LoadingState
            icon={<Store className="h-5 w-5" />}
            message="Consultando sedes del punto de venta"
          />
        </div>
      </GateScreen>
    );
  }

  if (workspace) return <>{workspace}</>;

  if (locations.length === 0) {
    return (
      <GateScreen>
        <EmptyState
          icon={<Store className="h-5 w-5" />}
          title="No tienes sedes asignadas"
          subtitle="Un administrador tiene que asignarte una sede en Sedes para que puedas cobrar."
        />
      </GateScreen>
    );
  }

  // Reopening the picker keeps the store the till is on as the marked one, so
  // leaving it takes a deliberate click.
  const current = listedStore(data, selectedId) ?? listedStore(data, data.checkoutLocationId);
  const changing = picking && current !== undefined;

  return (
    <GateScreen width="max-w-2xl">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight text-balance text-foreground sm:text-2xl">
          {changing ? "Cambiar de sede" : "¿Dónde vas a vender hoy?"}
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
          {changing ? (
            <>
              Ahora vendes en{" "}
              <span className="font-medium text-foreground">{current.name}</span>
              . Elige otra sede o sigue en la misma.
            </>
          ) : (
            "El cobro, el catálogo y el stock son los de la sede que elijas."
          )}
        </p>
      </div>

      <SitePicker
        sites={locations}
        currentId={changing ? current.id : undefined}
        onPick={(siteId) => {
          setSelectedId(siteId);
          setPicking(false);
        }}
        className="mt-6"
      />

      {changing && (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" onClick={() => setPicking(false)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Seguir en {current.name}
          </Button>
        </div>
      )}
    </GateScreen>
  );
}
