"use client";

import { useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  applyWaitingUpdate,
  getSwUpdateServerSnapshot,
  getSwUpdateSnapshot,
  subscribeToSwUpdate,
} from "@/lib/sw-update";

/**
 * Offers the code swap the worker is holding back for.
 *
 * The wording asks the operator to finish the sale in progress first, because
 * reloading mid-checkout is the failure this banner exists to prevent: the
 * worker waits indefinitely, so ignoring it costs nothing but a later update.
 */
export function UpdateAvailableBanner() {
  const updateAvailable = useSyncExternalStore(
    subscribeToSwUpdate,
    getSwUpdateSnapshot,
    getSwUpdateServerSnapshot
  );

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-light px-4 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2">
        <RefreshCw
          className="mt-0.5 h-4 w-4 shrink-0 text-primary-text"
          aria-hidden="true"
        />
        <p>
          Nueva versión disponible. Termina la venta en curso y recarga para
          actualizar.
        </p>
      </div>
      <Button
        size="sm"
        className="shrink-0"
        onClick={() => applyWaitingUpdate()}
      >
        Recargar
      </Button>
    </div>
  );
}
