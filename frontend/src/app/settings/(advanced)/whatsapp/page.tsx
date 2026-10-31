"use client";

import { useEffect, useState } from "react";
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
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { SettingsCard } from "../../_components/SettingsCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  useWhatsAppChallenge,
  useWhatsAppConnect,
  useWhatsAppDeliveries,
  useWhatsAppIdentities,
  useWhatsAppQr,
  useWhatsAppRevokeIdentity,
  useWhatsAppSendReport,
  useWhatsAppStatus,
  useWhatsAppStop,
} from "@/hooks/useWhatsApp";
import { getApiErrorMessage } from "@/lib/api";
import { hasAnyRole } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/utils";
import type {
  WhatsAppDeliveryFailure,
  WhatsAppDeliveryKind,
  WhatsAppIdentity,
  WhatsAppLinkChallenge,
  WhatsAppReportOutcome,
} from "@/types";

/** How often the link list refreshes while a code is waiting to be sent. */
const IDENTITY_POLL_MS = 5_000;

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
 * One line per answer the server gives to a manual send. `failed` completes its
 * sentence with the recorded reason; `no_identity` has no badge and offers the
 * action that fixes it instead of an error shell.
 */
const OUTCOME_COPY: Record<
  WhatsAppReportOutcome["status"],
  { badge: string | null; message: string }
> = {
  sent: {
    badge: "SENT",
    message: "El reporte se envió al número vinculado.",
  },
  failed: {
    badge: "FAILED",
    message: "No se envió el reporte.",
  },
  already_attempted: {
    badge: "ALREADY_ATTEMPTED",
    message: "Este reporte ya se había intentado, así que no se envió de nuevo.",
  },
  no_identity: {
    badge: null,
    message:
      "Todavía no hay un número verificado que reciba el reporte, así que no se envió nada.",
  },
};

/**
 * The send outcome, told as it happened: a send that the server reported as
 * failed is never dressed up as a success, and every answer lands in the same
 * polite status region.
 */
function ReportOutcome({
  outcome,
  onRequestCode,
}: {
  outcome: WhatsAppReportOutcome;
  onRequestCode: () => void;
}) {
  const copy = OUTCOME_COPY[outcome.status];
  const message =
    outcome.status === "failed"
      ? `No se envió el reporte: ${FAILURE_LABELS[outcome.reason]}.`
      : copy.message;

  return (
    <div
      role="status"
      className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        {copy.badge && (
          <StatusBadge domain="whatsapp-report" status={copy.badge} />
        )}
        <p className="min-w-0 text-xs text-foreground">{message}</p>
      </div>
      {outcome.status === "no_identity" && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={onRequestCode}
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Solicitar código de vinculación
        </Button>
      )}
    </div>
  );
}

/** Both states of the page open with the same title, so the outline never drifts. */
function PageIntro() {
  return (
    <div className="min-w-0">
      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
        WhatsApp
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Canal comercial, números vinculados y reporte diario
      </p>
    </div>
  );
}

/** The screen is for the people who may drive an administrative channel. */
function RestrictedNotice() {
  return (
    <div className="space-y-4">
      <PageIntro />
      <SettingsCard
        title="Acceso restringido"
        description="Esta sección la administra tu organización"
        icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
      >
        <p className="text-xs font-medium text-foreground">
          Solo la administración gestiona WhatsApp
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pide a un administrador de tu organización que abra esta sección.
        </p>
      </SettingsCard>
    </div>
  );
}

function WhatsAppSettings() {
  const toast = useToast();

  const statusQuery = useWhatsAppStatus();
  const connectSession = useWhatsAppConnect();
  const stopSession = useWhatsAppStop();

  const [linkCode, setLinkCode] = useState<WhatsAppLinkChallenge | null>(null);
  const [identityToRevoke, setIdentityToRevoke] =
    useState<WhatsAppIdentity | null>(null);
  const [reportOutcome, setReportOutcome] =
    useState<WhatsAppReportOutcome | null>(null);

  // While a code is on screen the operator is linking from their phone, so the
  // list has to pick up the new number without a reload.
  const identitiesQuery = useWhatsAppIdentities(
    linkCode ? IDENTITY_POLL_MS : undefined,
  );
  const requestChallenge = useWhatsAppChallenge();
  const revokeIdentity = useWhatsAppRevokeIdentity();

  const deliveriesQuery = useWhatsAppDeliveries();
  const sendReport = useWhatsAppSendReport();

  // The QR is a login credential: it is requested on demand and held only while
  // the operator is looking at it.
  const [qrRequested, setQrRequested] = useState(false);
  const qrQuery = useWhatsAppQr(qrRequested);

  const identities = identitiesQuery.data ?? [];
  const deliveries = deliveriesQuery.data ?? [];

  const sessionStatus = statusQuery.data?.status;
  const linkedAccount = statusQuery.data?.accountId ?? null;

  // A start is only meaningful when the channel is idle or gave up, and a stop
  // only when there is something running to stop.
  const canStart =
    !sessionStatus || sessionStatus === "STOPPED" || sessionStatus === "FAILED";
  const canStop = Boolean(sessionStatus) && sessionStatus !== "STOPPED";

  const sentCount = deliveries.filter((d) => d.status === "SENT").length;
  const failedCount = deliveries.filter((d) => d.status === "FAILED").length;
  const lastDelivery = deliveries.find((d) => d.sentAt) ?? deliveries[0] ?? null;

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
      // The QR of a stopped session is worthless, and the outcome described a
      // send against a channel that no longer exists.
      setQrRequested(false);
      setReportOutcome(null);
      toast.success("Sesión detenida");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo detener la sesión"));
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

  // A code is a credential with a deadline: it clears itself when it expires, so
  // a stale code cannot be read off the screen later.
  useEffect(() => {
    if (!linkCode) return;
    const remaining = new Date(linkCode.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setLinkCode(null);
      return;
    }
    const timer = setTimeout(() => setLinkCode(null), remaining);
    return () => clearTimeout(timer);
  }, [linkCode]);

  const handleRevoke = async () => {
    if (!identityToRevoke) return;
    try {
      await revokeIdentity.mutateAsync(identityToRevoke.id);
      setReportOutcome(null);
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
      if (qrQuery.isFetching) return;
      void qrQuery.refetch();
      return;
    }
    setQrRequested(true);
  };

  return (
    <div className="space-y-4">
      <PageIntro />

      <SettingsCard
        title="Canal comercial"
        description="Estado del número con el que se atiende a los clientes"
        icon={<MessageCircle className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="space-y-4">
          {statusQuery.isError && !statusQuery.data ? (
            <ErrorState
              message={channelErrorMessage(
                statusQuery.error,
                "No se pudo consultar el estado del canal",
              )}
              retryLabel="Reintentar"
              onRetry={() => void statusQuery.refetch()}
              className="min-h-[140px]"
            />
          ) : !statusQuery.data ? (
            <LoadingState
              icon={<MessageCircle className="h-4 w-4 text-muted-foreground" />}
              message="Consultando el estado del canal..."
              className="min-h-[140px]"
            />
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                {sessionStatus ? (
                  <StatusBadge
                    domain="whatsapp-session"
                    status={sessionStatus}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    El canal todavía no reporta un estado.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {linkedAccount ? (
                    <>
                      Cuenta del proveedor{" "}
                      <span className="font-mono tabular-nums text-foreground">
                        {linkedAccount}
                      </span>
                    </>
                  ) : (
                    "El canal no reporta una cuenta conectada."
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleConnect}
                  loading={connectSession.isPending}
                  disabled={!canStart}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Conectar sesión
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStop}
                  loading={stopSession.isPending}
                  disabled={!canStop}
                >
                  <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                  Detener sesión
                </Button>
              </div>
            </div>
          )}

          {/* The QR has its own lifecycle: a status the provider did not report
              never hides the credential an operator may need to scan. */}
          <div className="border-t border-border/60 pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">
                  Vinculación por código QR
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  El QR es una credencial de acceso: se pide aquí y cambia cada
                  vez que lo actualizas.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={toggleQr}
                loading={qrRequested && qrQuery.isFetching}
              >
                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                {qrRequested ? "Actualizar QR" : "Mostrar QR"}
              </Button>
            </div>

            {qrRequested && (
              <div className="mt-3">
                {qrQuery.isError ? (
                  <ErrorState
                    message={getApiErrorMessage(
                      qrQuery.error,
                      "No se pudo generar el código QR",
                    )}
                    retryLabel="Reintentar"
                    onRetry={() => void qrQuery.refetch()}
                    className="min-h-[160px]"
                  />
                ) : qrQuery.isLoading || !qrQuery.data ? (
                  <div
                    role="status"
                    aria-label="Generando el código QR"
                    className="h-48 w-48 animate-pulse rounded-lg border border-border/70 bg-muted/40"
                  />
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
                      Ocultar QR
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLinkCode(null)}
                >
                  Ocultar código de vinculación
                </Button>
              )}
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
              <div
                role="status"
                className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5"
              >
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

          {identitiesQuery.isLoading && !identitiesQuery.data ? (
            <div
              role="status"
              className="divide-y divide-border/60 border-t border-border/60"
            >
              <span className="sr-only">Cargando los números vinculados...</span>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-2 py-2.5"
                >
                  <div className="space-y-1.5">
                    <div className="h-3 w-32 animate-pulse rounded-full bg-muted-foreground/20" />
                    <div className="h-2.5 w-24 animate-pulse rounded-full bg-muted-foreground/15" />
                  </div>
                  <div className="h-5 w-20 animate-pulse rounded-full bg-muted-foreground/15" />
                </div>
              ))}
            </div>
          ) : identitiesQuery.isError && !identitiesQuery.data ? (
            <ErrorState
              message={channelErrorMessage(
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
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      domain="whatsapp-identity"
                      status={identity.status}
                    />
                    {identity.status === "VERIFIED" && (
                      <RowActions
                        label={`Acciones de ${identity.phone}`}
                        items={[
                          {
                            label: "Revocar número",
                            icon: <Ban className="h-3.5 w-3.5" aria-hidden="true" />,
                            destructive: true,
                            onSelect: () => setIdentityToRevoke(identity),
                          },
                        ]}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Reporte diario"
        description="Envío manual e historial de los envíos de la organización"
        icon={<Send className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              El envío manual va al número verificado más antiguo de tu usuario.
            </p>
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

          {deliveries.length > 0 && (
            <dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-border/70 bg-muted/20">
              <div className="min-w-0 border-r border-border/60 px-3 py-2.5">
                <dt className="text-[11px] text-muted-foreground">Enviados</dt>
                <dd className="mt-0.5 font-mono text-sm tabular-nums text-foreground">
                  {sentCount}
                </dd>
              </div>
              <div className="min-w-0 border-r border-border/60 px-3 py-2.5">
                <dt className="text-[11px] text-muted-foreground">Fallidos</dt>
                <dd className="mt-0.5 font-mono text-sm tabular-nums text-foreground">
                  {failedCount}
                </dd>
              </div>
              <div className="min-w-0 px-3 py-2.5">
                <dt className="text-[11px] text-muted-foreground">
                  Último envío
                </dt>
                <dd className="mt-0.5 text-xs text-foreground">
                  {lastDelivery
                    ? formatDate(lastDelivery.reportDate)
                    : "—"}
                </dd>
              </div>
            </dl>
          )}

          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            {deliveriesQuery.isLoading && !deliveriesQuery.data ? (
              <TableSkeleton
                columns={4}
                rows={6}
                label="Cargando envíos..."
                className="min-w-[420px] rounded-none border-0 bg-transparent"
              />
            ) : deliveriesQuery.isError && !deliveriesQuery.data ? (
              <ErrorState
                message={channelErrorMessage(
                  deliveriesQuery.error,
                  "No se pudo cargar el historial de envíos",
                )}
                retryLabel="Reintentar"
                onRetry={() => void deliveriesQuery.refetch()}
                className="mx-4 min-h-[140px] sm:mx-5"
              />
            ) : deliveries.length === 0 ? (
              <EmptyState
                icon={<Send className="h-5 w-5 text-muted-foreground" />}
                title="Sin envíos registrados"
                subtitle="El historial aparece cuando se envía el primer reporte."
                className="mx-4 sm:mx-5"
              />
            ) : (
              <Table className="min-w-[420px]">
                <TableHeader>
                  <TableRow>
                    <TableCell as="th">Tipo</TableCell>
                    <TableCell as="th">Fecha del reporte</TableCell>
                    <TableCell as="th">Estado</TableCell>
                    <TableCell as="th">Enviado el</TableCell>
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
                        <StatusBadge
                          domain="whatsapp-delivery"
                          status={delivery.status}
                        />
                        {delivery.status === "FAILED" &&
                          delivery.failureReason && (
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
            )}
          </div>
        </div>
      </SettingsCard>

      <ConfirmDialog
        isOpen={identityToRevoke !== null}
        onClose={() => setIdentityToRevoke(null)}
        onConfirm={handleRevoke}
        title="Revocar número"
        message="Ese número dejará de recibir el reporte diario y no podrá consultar información administrativa."
        confirmText="Revocar"
      />
    </div>
  );
}

/**
 * A 403 here is a permission/plan gate, not a transient failure: saying
 * "Forbidden" or offering retry to a user who will never be allowed helps
 * nobody. Everything else keeps the server message.
 */
function channelErrorMessage(error: unknown, fallback: string) {
  const status = (error as { response?: { status?: number } } | null)?.response
    ?.status;
  if (status === 403) {
    return "No tienes permiso para consultar el canal de WhatsApp de esta organización.";
  }
  return getApiErrorMessage(error, fallback);
}

export default function WhatsAppSettingsPage() {
  const { user } = useAuth();
  const canManage = hasAnyRole(user?.role, ["ADMIN"]);

  if (!canManage) return <RestrictedNotice />;
  return <WhatsAppSettings />;
}
