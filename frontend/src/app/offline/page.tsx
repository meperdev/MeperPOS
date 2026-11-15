"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { APP_NAME } from "@/lib/constants";

/**
 * Precache target of the service worker (`PWA_OFFLINE_URL`). It is shown when a
 * navigation cannot reach the network and the requested page was never cached.
 *
 * It fetches nothing of its own — no API call, no data — so it still renders
 * from the precached document and the root layout's chunks while the network is
 * down. It is not asset-free and cannot be: it needs its JavaScript like any
 * other route.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background pl-[max(1.5rem,var(--safe-left))] pr-[max(1.5rem,var(--safe-right))] pt-[max(1.5rem,var(--safe-top))] pb-[max(1.5rem,var(--safe-bottom))]">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="rounded-xl bg-primary-light p-4 text-primary">
          <CloudOff className="h-8 w-8" aria-hidden="true" />
        </div>

        <h1 className="text-lg font-semibold text-foreground">Sin conexión</h1>

        <p className="text-sm text-muted-foreground">
          {APP_NAME} no pudo alcanzar el servidor. Revisa la conexión e
          inténtalo de nuevo.
        </p>

        <Button onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Reintentar
        </Button>
      </div>
    </main>
  );
}
