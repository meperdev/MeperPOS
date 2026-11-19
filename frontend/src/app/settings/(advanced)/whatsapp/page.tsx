"use client";

import { Fragment, useEffect, useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronRight,
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
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { SettingsCard } from "../../_components/SettingsCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  useWhatsAppAutomaticSend,
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
import { formatDateShort, formatDateTime } from "@/lib/utils";
import type {
  WhatsAppDeliveryFailure,
  WhatsAppDeliveryKind,
  WhatsAppIdentity,
  WhatsAppLinkChallenge,
  WhatsAppReportOutcome,
} from "@/types";
import {
  formatDeliveryDay,
  groupDeliveries,
  groupHeadline,
  groupRange,
} from "./delivery-groups";
import { AutomaticSendStatus } from "./automatic-send";

/** How often the link list refreshes while a code is waiting to be sent. */
const IDENTITY_POLL_MS = 5_000;

/** How often the automatic-send state is refreshed while the page is open. */
const AUTOMATIC_STATE_POLL_MS = 5 * 60_000;

/** How many grouped rows the history shows before offering to open the rest. */
const HISTORY_GROUPS_LIMIT = 8;

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
        <p className="min-w-0 text-[13px] text-foreground">{message}</p>
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
      <p className="mt-0.5 text-[13px] text-muted-foreground">
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
        <p className="text-[13px] font-medium text-foreground">
          Solo la administración gestiona WhatsApp
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
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
  // The state changes on the server clock (the 20:00 run can pause it), so it is
  // always refreshed; faster while a code is on screen, because a number verified
  // from a phone is what turns "pausado sin número" back into "activo".
  const automaticQuery = useWhatsAppAutomaticSend(
    linkCode ? IDENTITY_POLL_MS : AUTOMATIC_STATE_POLL_MS,
  );
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );

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
  // The last report that left, never the last attempt: a failed day is not an envío.
  const lastDelivery =
    deliveries.find((delivery) => delivery.status === "SENT") ?? null;

  // Consecutive identical attempts are one row, so eleven failed days read as one
  // line and the days themselves stay behind a disclosure.
  const groups = groupDeliveries(deliveries);
  const visibleGroups = showAllGroups
    ? groups
    : groups.slice(0, HISTORY_GROUPS_LIMIT);

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
    const remaining = Math.max(
      0,
      new Date(linkCode.expiresAt).getTime() - Date.now(),
    );
    // Always through the timer, never synchronously in the effect body.
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

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="@container space-y-4">
      <PageIntro />

      <div className="grid gap-4 @4xl:grid-cols-2 @4xl:items-stretch">
        <SettingsCard
          className="h-full @container"
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
            <div
              role="status"
              className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3"
            >
              <span className="sr-only">Consultando el estado del canal…</span>
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted-foreground/40" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 w-24 animate-pulse rounded-full bg-muted-foreground/20" />
                <div className="h-2 w-32 animate-pulse rounded-full bg-muted-foreground/15" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                {sessionStatus ? (
                  <StatusBadge
                    domain="whatsapp-session"
                    status={sessionStatus}
                  />
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    El canal todavía no reporta un estado.
                  </p>
                )}
                <p className="text-[13px] text-muted-foreground">
                  {linkedAccount ? (
                    <>
                      Cuenta del proveedor{" "}
                      <span className="tabular-nums text-foreground">
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
            <div className="flex flex-col gap-2 @md:flex-row @md:items-start @md:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">
                  Vinculación por código QR
                </p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  El QR es una credencial de acceso: se pide aquí y cambia cada
                  vez que lo actualizas.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 whitespace-nowrap"
                onClick={toggleQr}
                loading={qrRequested && qrQuery.isFetching}
              >
                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                {qrRequested ? "Actualizar QR" : "Mostrar QR"}
              </Button>
            </div>

            {qrRequested && (
              <div className="mt-3 flex flex-col gap-3 @md:flex-row @md:items-start">
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
          className="h-full"
          title="Número vinculado"
        description="El vínculo entre tu WhatsApp y tu usuario de MeperPOS"
        icon={<Link2 className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-[13px] text-muted-foreground">
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
                <span className="text-[13px] text-muted-foreground">
                  Vence el{" "}
                  <span className="tabular-nums text-foreground">
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
                <p className="text-[13px] text-muted-foreground">
                  Escribe este código desde WhatsApp al número administrativo. Se
                  muestra una sola vez.
                </p>
                <p
                  data-testid="whatsapp-link-code"
                  className="mt-1 id-text text-lg font-bold tabular-nums tracking-[0.2em] text-foreground"
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
              <span className="sr-only">Cargando los números vinculados…</span>
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
              className="min-h-0 py-6"
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
                    <p className="text-[13px] tabular-nums text-foreground">
                      {identity.phone}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
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
      </div>

      <SettingsCard
        title="Reporte diario"
        description="Envío manual e historial de los envíos de la organización"
        icon={<Send className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="space-y-4">
          <AutomaticSendStatus
            state={automaticQuery.data}
            isLoading={automaticQuery.isLoading}
            isError={automaticQuery.isError}
            onRetry={() => void automaticQuery.refetch()}
            onLinkNumber={handleRequestCode}
            onResume={handleSendReport}
            linking={requestChallenge.isPending}
            resuming={sendReport.isPending}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">
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
            <dl className="grid grid-cols-1 overflow-hidden rounded-lg border border-border/70 bg-muted/20 sm:grid-cols-3">
              <div className="min-w-0 border-b border-border/60 px-3 py-2.5 sm:border-b-0 sm:border-r">
                <dt className="text-[13px] text-muted-foreground">Enviados</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-foreground">
                  {sentCount}
                </dd>
              </div>
              <div className="min-w-0 border-b border-border/60 px-3 py-2.5 sm:border-b-0 sm:border-r">
                <dt className="text-[13px] text-muted-foreground">
                  Último envío
                </dt>
                <dd className="mt-0.5 text-[13px] text-foreground">
                  {lastDelivery ? formatDateShort(lastDelivery.reportDate) : "—"}
                </dd>
              </div>
              {/* Failures are the quiet figure: the history below already says why. */}
              <div className="min-w-0 px-3 py-2.5">
                <dt className="text-[13px] text-muted-foreground">
                  Fallos recientes
                </dt>
                <dd className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                  {failedCount}
                </dd>
              </div>
            </dl>
          )}

          <div>
            {deliveriesQuery.isLoading && !deliveriesQuery.data ? (
              <div className="-mx-4 overflow-x-auto sm:-mx-5">
                <TableSkeleton
                  columns={4}
                  rows={6}
                  label="Cargando envíos…"
                  className="min-w-[420px] rounded-none border-0 bg-transparent"
                />
              </div>
            ) : deliveriesQuery.isError && !deliveriesQuery.data ? (
              <ErrorState
                message={channelErrorMessage(
                  deliveriesQuery.error,
                  "No se pudo cargar el historial de envíos",
                )}
                retryLabel="Reintentar"
                onRetry={() => void deliveriesQuery.refetch()}
                className="min-h-[140px]"
              />
            ) : deliveries.length === 0 ? (
              <EmptyState
                icon={<Send className="h-4 w-4" />}
                title="Sin envíos registrados"
                subtitle="El historial aparece cuando se envía el primer reporte."
                className="min-h-[140px]"
              />
            ) : (
              <>
                <div className="-mx-4 overflow-x-auto sm:-mx-5">
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
                      {visibleGroups.map((group) => {
                        const single = group.members.length === 1;
                        const open =
                          !single && Boolean(expandedGroups[group.key]);
                        // A group of one is the attempt itself, rendered as a row.
                        const attempt = group.members[0];

                        return (
                          <Fragment key={group.key}>
                            <TableRow>
                              <TableCell className="text-foreground">
                                {KIND_LABELS[group.kind]}
                              </TableCell>
                              <TableCell className="text-foreground">
                                {single ? (
                                  <span className="tabular-nums">
                                    {formatDateShort(attempt.reportDate)}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => toggleGroup(group.key)}
                                    aria-expanded={open}
                                    data-testid="delivery-group-summary"
                                    className="flex min-w-0 items-start gap-1.5 text-left"
                                  >
                                    {open ? (
                                      <ChevronDown
                                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <ChevronRight
                                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                        aria-hidden="true"
                                      />
                                    )}
                                    <span className="min-w-0">
                                      <span className="block text-foreground">
                                        {groupHeadline(group)}
                                      </span>
                                      <span className="block text-[13px] tabular-nums text-muted-foreground">
                                        {groupRange(group)}
                                      </span>
                                    </span>
                                  </button>
                                )}
                              </TableCell>
                              <TableCell>
                                <StatusBadge
                                  domain="whatsapp-delivery"
                                  status={group.status}
                                />
                                {group.status === "FAILED" &&
                                  group.failureReason && (
                                    <span className="mt-0.5 block text-[13px] text-muted-foreground">
                                      {FAILURE_LABELS[group.failureReason]}
                                    </span>
                                  )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                                {single && attempt.sentAt
                                  ? formatDateTime(attempt.sentAt)
                                  : "—"}
                              </TableCell>
                            </TableRow>

                            {open &&
                              group.members.map((day) => (
                                <TableRow key={`${group.key}:${day.id}`}>
                                  <TableCell>{null}</TableCell>
                                  <TableCell className="pl-6 text-sm tabular-nums text-muted-foreground">
                                    {formatDeliveryDay(day.reportDate)}
                                  </TableCell>
                                  <TableCell>{null}</TableCell>
                                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                                    {day.sentAt
                                      ? formatDateTime(day.sentAt)
                                      : "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>

                {groups.length > HISTORY_GROUPS_LIMIT && (
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAllGroups((current) => !current)}
                    >
                      {showAllGroups ? "Ver menos" : "Ver más"}
                    </Button>
                  </div>
                )}
              </>
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
