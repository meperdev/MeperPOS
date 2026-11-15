"use client";

import { useState } from "react";
import {
  Link2,
  Loader2,
  Play,
  QrCode,
  RefreshCw,
  RotateCw,
  Square,
  Terminal,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/contexts/ToastContext";
import { formatDateTime } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api";
import {
  useCentralConnect,
  useCentralRelink,
  useCentralRestart,
  useCentralSession,
  useCentralSessionQr,
  useCentralStop,
} from "@/hooks/useWhatsAppIntelligence";

/** The provider reports `57311@c.us`; the operator reads the number. */
function readablePhone(accountId: string | null): string | null {
  if (!accountId) return null;
  return accountId.replace(/@.*$/, "");
}

/**
 * The console for the central `meper-intelligence` channel.
 *
 * The number is one physical phone owned by the platform, so this screen is the
 * platform's, not a tenant's: it can observe, re-link, stop and restart, and it
 * cannot touch a commercial session. Pairing is still an operator act with a
 * short-lived credential, so the QR is fetched only when asked for, is never
 * cached, and the same operation is offered as a server command for the case
 * where nobody has a browser open.
 */
export default function AdminWhatsAppPage() {
  const session = useCentralSession();
  const connect = useCentralConnect();
  const relink = useCentralRelink();
  const stop = useCentralStop();
  const restart = useCentralRestart();
  const toast = useToast();

  const [qrRequested, setQrRequested] = useState(false);
  const [confirmingRelink, setConfirmingRelink] = useState(false);

  const status = session.data?.status;
  const isWorking = status === "WORKING";
  const canShowQr = qrRequested && !isWorking;
  const qr = useCentralSessionQr(canShowQr);

  const report = (error: unknown, fallback: string) =>
    toast.error(getApiErrorMessage(error, fallback));

  const start = async () => {
    try {
      await connect.mutateAsync();
      setQrRequested(true);
      toast.success("Sesión iniciada. Escaneá el código desde el teléfono central.");
    } catch (error) {
      report(error, "No se pudo iniciar la sesión central");
    }
  };

  const relinkNumber = async () => {
    setConfirmingRelink(false);
    try {
      await relink.mutateAsync();
      setQrRequested(true);
      toast.success("Número desvinculado. Escaneá el código nuevo desde el teléfono central.");
    } catch (error) {
      report(error, "No se pudo re-vincular el número central");
    }
  };

  const halt = async () => {
    try {
      await stop.mutateAsync();
      setQrRequested(false);
      toast.success("Sesión detenida.");
    } catch (error) {
      report(error, "No se pudo detener la sesión central");
    }
  };

  const bounce = async () => {
    try {
      await restart.mutateAsync();
      toast.success("Sesión reiniciada.");
    } catch (error) {
      report(error, "No se pudo reiniciar la sesión central");
    }
  };

  if (session.isLoading) {
    return (
      <LoadingState
        icon={<Loader2 className="h-8 w-8 animate-spin" />}
        message="Consultando el canal central..."
      />
    );
  }

  if (session.isError) {
    return (
      <ErrorState
        message={getApiErrorMessage(
          session.error,
          "No se pudo consultar el canal central",
        )}
        retryLabel="Reintentar"
        onRetry={() => void session.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <header className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">WhatsApp central</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          El número administrativo de MeperPOS Intelligence. Es uno solo para toda
          la plataforma y no pertenece a ninguna organización.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Estado del canal</h3>
              <p className="text-xs text-muted-foreground">
                Lo que el proveedor reporta en este momento.
              </p>
            </div>
            {status && (
              <StatusBadge domain="whatsapp-session" status={status} />
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Número vinculado</dt>
                <dd className="mt-0.5 font-mono text-sm text-foreground">
                  {readablePhone(session.data?.accountId ?? null) ?? "Sin vincular"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Sesión del proveedor</dt>
                <dd className="mt-0.5 truncate font-mono text-sm text-foreground">
                  {session.data?.sessionName ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Última consulta</dt>
                <dd className="mt-0.5 text-sm text-foreground">
                  {session.data?.lastObservedAt
                    ? formatDateTime(session.data.lastObservedAt)
                    : "—"}
                </dd>
              </div>
            </dl>

            {confirmingRelink ? (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <p className="text-sm text-foreground">
                  Se va a desvincular el número central. La administradora deja de
                  recibir respuestas hasta que se escanee un código nuevo.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    loading={relink.isPending}
                    onClick={() => void relinkNumber()}
                  >
                    Sí, re-vincular
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmingRelink(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!isWorking && (
                  <Button
                    size="sm"
                    loading={connect.isPending}
                    onClick={() => void start()}
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Iniciar
                  </Button>
                )}
                {isWorking && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmingRelink(true)}
                  >
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Re-vincular
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  loading={restart.isPending}
                  onClick={() => void bounce()}
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reiniciar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={stop.isPending}
                  onClick={() => void halt()}
                >
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                  Detener
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Vinculación</h3>
              <p className="text-xs text-muted-foreground">
                El código se renueva solo cada pocos segundos.
              </p>
            </div>
            {!isWorking && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 whitespace-nowrap"
                loading={canShowQr && qr.isFetching}
                onClick={() => setQrRequested((requested) => !requested)}
              >
                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                {canShowQr ? "Ocultar QR" : "Mostrar QR"}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {isWorking ? (
              <p className="text-sm text-muted-foreground">
                El número está vinculado y el canal responde. Para vincular otro
                teléfono, usá Re-vincular.
              </p>
            ) : !canShowQr ? (
              <p className="text-sm text-muted-foreground">
                Pedí el código y escanealo desde el teléfono central con WhatsApp
                abierto.
              </p>
            ) : qr.isError ? (
              <ErrorState
                message={getApiErrorMessage(
                  qr.error,
                  "No se pudo generar el código QR",
                )}
                retryLabel="Reintentar"
                onRetry={() => void qr.refetch()}
                className="min-h-[160px]"
              />
            ) : !qr.data ? (
              <div
                role="status"
                aria-label="Generando el código QR"
                className="h-48 w-48 animate-pulse rounded-lg border border-border/70 bg-muted/40"
              />
            ) : (
              <div className="flex flex-col items-start gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${qr.data.data}`}
                  alt="Código QR para vincular el número central"
                  className="h-48 w-48 rounded-lg border border-border/70 bg-card p-2"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  loading={qr.isFetching}
                  onClick={() => void qr.refetch()}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Actualizar QR
                </Button>
              </div>
            )}

            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                Sin navegador
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                En el servidor, la misma vinculación corre sin credenciales de
                MeperPOS:
              </p>
              <code className="mt-2 block overflow-x-auto rounded bg-background/60 px-2 py-1 font-mono text-xs text-foreground">
                npm run whatsapp:link
              </code>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
