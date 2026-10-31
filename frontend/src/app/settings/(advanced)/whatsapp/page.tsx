"use client";

import { useState, type ReactNode } from "react";
import {
  Ban,
  Link2,
  MessageCircle,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  useWhatsAppChallenge,
  useWhatsAppConnect,
  useWhatsAppDeliveries,
  useWhatsAppIdentities,
  useWhatsAppQr,
  useWhatsAppRestart,
  useWhatsAppRevokeIdentity,
  useWhatsAppSendReport,
  useWhatsAppStatus,
  useWhatsAppStop,
} from "@/hooks/useWhatsApp";
import { getApiErrorMessage } from "@/lib/api";
import { hasAnyRole } from "@/lib/auth";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import type {
  WhatsAppDeliveryFailure,
  WhatsAppDeliveryKind,
  WhatsAppDeliveryStatus,
  WhatsAppIdentity,
  WhatsAppIdentityStatus,
  WhatsAppLinkChallenge,
  WhatsAppReportOutcome,
  WhatsAppSessionStatus,
} from "@/types";

/** The three tones a status may carry; the dot is the only colour signal. */
type StatusTone = "ok" | "pending" | "failed" | "idle";

const STATUS_DOT: Record<StatusTone, string> = {
  ok: "bg-success",
  pending: "bg-warning",
  failed: "bg-danger",
  idle: "bg-muted-foreground",
};

/**
 * Status is one luminous dot plus sentence-case text: no coloured capsule, no
 * duplicated bullet glyph, no shouting label.
 */
function StatusMark({
  tone,
  label,
}: {
  tone: StatusTone;
  label: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-foreground">
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[tone])}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** A bento panel: one outer card, a quiet header, and the body. */
function Panel({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-card">
      <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-foreground">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

const SESSION_LABELS: Record<WhatsAppSessionStatus, string> = {
  STOPPED: "Detenido",
  STARTING: "Iniciando",
  SCAN_QR_CODE: "Esperando el escaneo del código QR",
  PASSKEY_REQUIRED: "Requiere passkey",
  PASSKEY_CONFIRMATION_REQUIRED: "Requiere confirmar la passkey",
  WORKING: "Conectado",
  FAILED: "No se pudo conectar",
};

const SESSION_TONES: Record<WhatsAppSessionStatus, StatusTone> = {
  STOPPED: "idle",
  STARTING: "pending",
  SCAN_QR_CODE: "pending",
  PASSKEY_REQUIRED: "pending",
  PASSKEY_CONFIRMATION_REQUIRED: "pending",
  WORKING: "ok",
  FAILED: "failed",
};

const IDENTITY_LABELS: Record<WhatsAppIdentityStatus, string> = {
  PENDING: "Pendiente",
  VERIFIED: "Verificado",
  REVOKED: "Revocado",
};

const IDENTITY_TONES: Record<WhatsAppIdentityStatus, StatusTone> = {
  PENDING: "pending",
  VERIFIED: "ok",
  REVOKED: "idle",
};

const DELIVERY_LABELS: Record<WhatsAppDeliveryStatus, string> = {
  PENDING: "En curso",
  SENT: "Enviado",
  FAILED: "Falló",
};

const DELIVERY_TONES: Record<WhatsAppDeliveryStatus, StatusTone> = {
  PENDING: "pending",
  SENT: "ok",
  FAILED: "failed",
};

const KIND_LABELS: Record<WhatsAppDeliveryKind, string> = {
  SCHEDULED: "Automático",
  ON_DEMAND: "Manual",
};

/** Every fixed failure code the backend may record, in plain sentences. */
const FAILURE_LABELS: Record<WhatsAppDeliveryFailure, string> = {
  no_recipient: "no hay un número verificado que reciba el reporte",
  organization_ambiguous: "la conexión central atiende varias organizaciones",
  report_failed: "no se pudo generar el reporte",
  render_failed: "no se pudo generar el PDF",
  provider_rejected: "WhatsApp rechazó el envío",
  send_failed: "el envío falló",
};

/**
 * The send outcome, told as it happened: a send that the server reported as
 * failed is never dressed up as a success, and the missing-identity answer offers
 * the action that fixes it instead of an error box.
 */
function ReportOutcome({
  outcome,
  onRequestCode,
}: {
  outcome: WhatsAppReportOutcome;
  onRequestCode: () => void;
}) {
  if (outcome.status === "no_identity") {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
        <p className="text-xs text-foreground">
          Todavía no hay un número verificado que reciba el reporte, así que no se
          envió nada.
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={onRequestCode}>
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Solicitar código de vinculación
        </Button>
      </div>
    );
  }

  if (outcome.status === "failed") {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
        <StatusMark
          tone="failed"
          label={`No se envió el reporte: ${FAILURE_LABELS[outcome.reason]}`}
        />
      </div>
    );
  }

  if (outcome.status === "already_attempted") {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
        <StatusMark tone="pending" label="Este reporte ya se había intentado" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
      <StatusMark tone="ok" label="Reporte enviado al número vinculado" />
    </div>
  );
}

/** The screen is for the people who may drive an administrative channel. */
function RestrictedNotice() {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-5 py-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Solo la administración gestiona WhatsApp
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pide a un administrador de tu organización que abra esta sección.
          </p>
        </div>
      </div>
    </div>
  );
}

function WhatsAppSettings() {
  const toast = useToast();

  const statusQuery = useWhatsAppStatus();
  const connectSession = useWhatsAppConnect();
  const stopSession = useWhatsAppStop();
  const restartSession = useWhatsAppRestart();

  const identitiesQuery = useWhatsAppIdentities();
  const requestChallenge = useWhatsAppChallenge();
  const revokeIdentity = useWhatsAppRevokeIdentity();

  const deliveriesQuery = useWhatsAppDeliveries();
  const sendReport = useWhatsAppSendReport();

  // The QR is a login credential: it is requested on demand and held only while
  // the operator is looking at it.
  const [qrRequested, setQrRequested] = useState(false);
  const qrQuery = useWhatsAppQr(qrRequested);

  const [linkCode, setLinkCode] = useState<WhatsAppLinkChallenge | null>(null);
  const [identityToRevoke, setIdentityToRevoke] = useState<WhatsAppIdentity | null>(
    null,
  );
  const [reportOutcome, setReportOutcome] = useState<WhatsAppReportOutcome | null>(
    null,
  );

  const identities = identitiesQuery.data ?? [];
  const deliveries = deliveriesQuery.data ?? [];

  const handleConnect = async () => {
    try {
      await connectSession.mutateAsync();
      toast.success("Conexión iniciada");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo iniciar la conexión"));
    }
  };

  const handleStop = async () => {
    try {
      await stopSession.mutateAsync();
      toast.success("Sesión detenida");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo detener la sesión"));
    }
  };

  const handleRestart = async () => {
    try {
      await restartSession.mutateAsync();
      toast.success("Sesión reiniciada");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo reiniciar la sesión"));
    }
  };

  const handleRequestCode = async () => {
    try {
      const issued = await requestChallenge.mutateAsync();
      setLinkCode(issued);
    } catch (error) {
      toast.error(
        getApiErrorMessage(error, "No se pudo generar el código de vinculación"),
      );
    }
  };

  const handleRevoke = async () => {
    if (!identityToRevoke) return;
    try {
      await revokeIdentity.mutateAsync(identityToRevoke.id);
      toast.success("Número revocado");
      setIdentityToRevoke(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo revocar el número"));
    }
  };

  const handleSendReport = async () => {
    setReportOutcome(null);
    try {
      const outcome = await sendReport.mutateAsync();
      setReportOutcome(outcome);
      if (outcome.status === "sent") toast.success("Reporte enviado");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo enviar el reporte"));
    }
  };

  const toggleQr = () => {
    if (qrRequested) {
      // Asking again is a request for a fresh image: the old one may already be
      // stale, so the query is refetched instead of re-rendered from cache.
      void qrQuery.refetch();
      return;
    }
    setQrRequested(true);
  };

  const sessionStatus = statusQuery.data?.status;
  const linkedNumber = statusQuery.data?.accountId ?? null;

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-foreground">WhatsApp</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          El canal comercial, los números vinculados y el envío del reporte diario.
        </p>
      </div>

      <Panel
        title="Canal comercial"
        description="Estado del número con el que se atiende a los clientes"
        icon={<MessageCircle className="h-4 w-4" aria-hidden="true" />}
      >
        {statusQuery.isLoading || !sessionStatus ? (
          statusQuery.isError ? (
            <ErrorState
              message={getApiErrorMessage(
                statusQuery.error,
                "No se pudo consultar el estado del canal",
              )}
              retryLabel="Reintentar"
              onRetry={() => void statusQuery.refetch()}
              className="min-h-[140px]"
            />
          ) : (
            <LoadingState
              icon={<MessageCircle className="h-4 w-4 text-muted-foreground" />}
              message="Consultando el estado del canal..."
              className="min-h-[140px]"
            />
          )
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <StatusMark
                  tone={SESSION_TONES[sessionStatus]}
                  label={SESSION_LABELS[sessionStatus]}
                />
                {linkedNumber && (
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {linkedNumber}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleConnect}
                  loading={connectSession.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Conectar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStop}
                  loading={stopSession.isPending}
                  disabled={sessionStatus === "STOPPED"}
                >
                  <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                  Detener
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleRestart}
                  loading={restartSession.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reiniciar
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">
                    Código QR de vinculación
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    El código QR es una credencial de acceso: caduca en minutos y
                    cambia cada vez que lo generas.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={toggleQr}>
                  <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                  {qrRequested ? "Actualizar código" : "Mostrar código"}
                </Button>
              </div>

              {qrRequested && (
                <div className="mt-3">
                  {qrQuery.isError ? (
                    <div role="alert" className="text-xs text-muted-foreground">
                      No se pudo generar el código QR.
                      <button
                        type="button"
                        onClick={() => void qrQuery.refetch()}
                        className="ml-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        Reintentar
                      </button>
                    </div>
                  ) : qrQuery.isLoading || !qrQuery.data ? (
                    <p className="text-xs text-muted-foreground">
                      Generando el código...
                    </p>
                  ) : (
                    <div className="flex flex-col items-start gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:image/png;base64,${qrQuery.data.data}`}
                        alt="Código QR para vincular el número de WhatsApp"
                        className="h-48 w-48 rounded-lg border border-border/70 bg-card p-2"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setQrRequested(false)}
                      >
                        Ocultar el código
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Número vinculado"
        description="El vínculo entre tu WhatsApp y tu usuario de MeperPOS"
        icon={<Link2 className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              El asistente administrativo reconoce a una persona por este vínculo,
              nunca por una lista de teléfonos: sin un número verificado, el
              reporte diario no se envía a nadie.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleRequestCode}
                loading={requestChallenge.isPending}
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                Solicitar código
              </Button>
              {linkCode && (
                <span className="text-xs text-muted-foreground">
                  Vence el{" "}
                  <span className="font-mono tabular-nums text-foreground">
                    {formatDateTime(linkCode.expiresAt)}
                  </span>
                </span>
              )}
            </div>
            {linkCode && (
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Escribe este código desde WhatsApp al número administrativo. Se
                  muestra una sola vez.
                </p>
                <p
                  data-testid="whatsapp-link-code"
                  className="mt-1 font-mono text-lg font-bold tabular-nums tracking-[0.2em] text-foreground"
                >
                  {linkCode.code}
                </p>
              </div>
            )}
          </div>

          {identitiesQuery.isLoading ? (
            <LoadingState
              icon={<Link2 className="h-4 w-4 text-muted-foreground" />}
              message="Cargando los números vinculados..."
              className="min-h-[140px]"
            />
          ) : identitiesQuery.isError ? (
            <ErrorState
              message={getApiErrorMessage(
                identitiesQuery.error,
                "No se pudieron cargar los números vinculados",
              )}
              retryLabel="Reintentar"
              onRetry={() => void identitiesQuery.refetch()}
              className="min-h-[140px]"
            />
          ) : identities.length === 0 ? (
            <EmptyState
              icon={<Link2 className="h-5 w-5 text-muted-foreground" />}
              title="Sin números vinculados"
              subtitle="Solicita un código y escríbelo desde el WhatsApp que quieres vincular."
            />
          ) : (
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {identities.map((identity) => (
                <li
                  key={identity.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-mono text-xs tabular-nums text-foreground">
                      {identity.phone}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {identity.verifiedAt
                        ? `Verificado el ${formatDateTime(identity.verifiedAt)}`
                        : "Sin verificar"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusMark
                      tone={IDENTITY_TONES[identity.status]}
                      label={IDENTITY_LABELS[identity.status]}
                    />
                    {identity.status === "VERIFIED" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIdentityToRevoke(identity)}
                        aria-label={`Revocar ${identity.phone}`}
                      >
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                        Revocar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel
        title="Reporte diario"
        description="Envío manual e historial de los reportes al número vinculado"
        icon={<Send className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleSendReport}
              loading={sendReport.isPending}
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Enviar reporte ahora
            </Button>
          </div>

          {reportOutcome && (
            <ReportOutcome
              outcome={reportOutcome}
              onRequestCode={handleRequestCode}
            />
          )}

          {deliveriesQuery.isLoading ? (
            <LoadingState
              icon={<Send className="h-4 w-4 text-muted-foreground" />}
              message="Cargando los envíos..."
              className="min-h-[140px]"
            />
          ) : deliveriesQuery.isError ? (
            <ErrorState
              message={getApiErrorMessage(
                deliveriesQuery.error,
                "No se pudo cargar el historial de envíos",
              )}
              retryLabel="Reintentar"
              onRetry={() => void deliveriesQuery.refetch()}
              className="min-h-[140px]"
            />
          ) : deliveries.length === 0 ? (
            <EmptyState
              icon={<Send className="h-5 w-5 text-muted-foreground" />}
              title="Sin envíos registrados"
              subtitle="El historial aparece cuando se envía el primer reporte."
            />
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <Table className="min-w-[420px]">
                <TableHeader>
                  <TableRow>
                    <TableCell
                      as="th"
                      className="text-left font-medium text-muted-foreground"
                    >
                      Tipo
                    </TableCell>
                    <TableCell
                      as="th"
                      className="text-left font-medium text-muted-foreground"
                    >
                      Fecha del reporte
                    </TableCell>
                    <TableCell
                      as="th"
                      className="text-left font-medium text-muted-foreground"
                    >
                      Estado
                    </TableCell>
                    <TableCell
                      as="th"
                      className="text-left font-medium text-muted-foreground"
                    >
                      Enviado el
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell className="text-foreground">
                        {KIND_LABELS[delivery.kind]}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-foreground">
                        {formatDate(delivery.reportDate)}
                      </TableCell>
                      <TableCell>
                        <StatusMark
                          tone={DELIVERY_TONES[delivery.status]}
                          label={DELIVERY_LABELS[delivery.status]}
                        />
                        {delivery.status === "FAILED" && delivery.failureReason && (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {FAILURE_LABELS[delivery.failureReason]}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {delivery.sentAt ? formatDateTime(delivery.sentAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </div>
      </Panel>

      <ConfirmDialog
        isOpen={identityToRevoke !== null}
        onClose={() => setIdentityToRevoke(null)}
        onConfirm={handleRevoke}
        title="Revocar el número"
        message="Ese número dejará de recibir el reporte diario y no podrá consultar información administrativa."
        confirmText="Revocar"
      />
    </div>
  );
}

export default function WhatsAppSettingsPage() {
  const { user } = useAuth();
  const canManage = hasAnyRole(user?.role, ["ADMIN"]);

  if (!canManage) return <RestrictedNotice />;
  return <WhatsAppSettings />;
}
