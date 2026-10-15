"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { APP_NAME } from "@/lib/constants";

/**
 * Precache target of the service worker (`PWA_OFFLINE_URL`). It is shown when a
 * navigation cannot reach the network and the requested page was never cached.
 * Deliberately dependency-free: it has to render from the service worker's
 * cache alone, with no request of its own.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="rounded-2xl bg-primary-light p-4 text-primary">
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
