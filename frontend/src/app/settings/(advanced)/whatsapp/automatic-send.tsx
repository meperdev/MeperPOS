"use client";

import { Link2, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import type { WhatsAppAutomaticSend, WhatsAppAutomaticSendState } from "@/types";

/**
 * How each state reads. The dot is the only colour: a 6px mark plus the state's
 * own words, so the card never depends on colour alone.
 */
const STATE_COPY: Record<
  WhatsAppAutomaticSendState,
  { label: string; dot: string }
> = {
  active: { label: "Activo", dot: "bg-success" },
  paused_no_recipient: { label: "Pausado sin número", dot: "bg-warning" },
  paused_failures: { label: "Pausado por fallos", dot: "bg-danger" },
};

/** The line under the state: what it runs on, or why it is not running. */
function detailOf(state: WhatsAppAutomaticSend): string {
  switch (state.state) {
    case "active":
      // The schedule is fixed; the date is what changes, in the reader's own clock.
      return `Todos los días a las 8:00 p. m. · próximo envío ${formatDate(state.nextRunAt)}`;
    case "paused_no_recipient":
      return "No hay un número verificado que reciba el reporte.";
    case "paused_failures":
      // The count comes from the server, so the sentence cannot outlive the rule.
      return `Se pausó tras ${state.consecutiveFailures} fallos seguidos${
        state.pausedSince ? ` el ${formatDateTime(state.pausedSince)}` : ""
      }.`;
  }
}

interface AutomaticSendStatusProps {
  state: WhatsAppAutomaticSend | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** The page's own link flow: the same code an operator asks for below. */
  onLinkNumber: () => void;
  /** The manual report, which is what resumes a paused automatic send. */
  onResume: () => void;
  linking: boolean;
  resuming: boolean;
}

/**
 * Whether the daily report will send itself, told before anything else in the
 * "Reporte diario" card. The action depends on the reason: a number to link when
 * there is none, the manual report when the streak paused it. A state that has
 * not arrived yet says so instead of guessing "activo".
 */
export function AutomaticSendStatus({
  state,
  isLoading,
  isError,
  onRetry,
  onLinkNumber,
  onResume,
  linking,
  resuming,
}: AutomaticSendStatusProps) {
  if (!state && isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          No se pudo consultar el envío automático.
        </p>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (!state) {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5"
        aria-busy={isLoading}
      >
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/40" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Envío automático</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Consultando el envío automático…
          </p>
        </div>
      </div>
    );
  }

  const copy = STATE_COPY[state.state];

  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <span
          aria-hidden="true"
          data-testid="automatic-send-dot"
          className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", copy.dot)}
        />
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-medium text-foreground">
            Envío automático{" "}
            <span className="font-normal text-muted-foreground">
              {copy.label}
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">{detailOf(state)}</p>
        </div>
      </div>

      {state.state === "paused_no_recipient" && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={onLinkNumber}
          loading={linking}
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Vincular número
        </Button>
      )}

      {state.state === "paused_failures" && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={onResume}
          loading={resuming}
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          Enviar ahora para reanudar
        </Button>
      )}
    </div>
  );
}
