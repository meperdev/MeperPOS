"use client";

import { Badge } from "@/components/ui/Badge";

/**
 * One map for every status the app paints. A status badge is text + colour +
 * dot (never colour alone), and every surface resolves the same string to the
 * same tone: sales, expenses, purchase orders, loans and the WhatsApp channel.
 */
export type StatusDomain =
  | "sale"
  | "expense"
  | "purchase-order"
  | "loan"
  | "whatsapp-session"
  | "whatsapp-identity"
  | "whatsapp-delivery"
  | "whatsapp-report";

export type StatusTone =
  | "success"
  | "warning"
  | "danger"
  | "primary"
  | "default";

interface StatusMeta {
  label: string;
  tone: StatusTone;
}

const STATUS_META: Record<StatusDomain, Record<string, StatusMeta>> = {
  sale: {
    COMPLETED: { label: "Completada", tone: "success" },
    CANCELLED: { label: "Cancelada", tone: "danger" },
    RETURNED_PARTIAL: { label: "Parcial", tone: "warning" },
  },
  expense: {
    PAID: { label: "Pagado", tone: "success" },
    PENDING: { label: "Parcial", tone: "warning" },
  },
  "purchase-order": {
    DRAFT: { label: "Borrador", tone: "default" },
    PENDING: { label: "Pendiente", tone: "primary" },
    PARTIAL_RECEIVED: { label: "Recibida parcial", tone: "warning" },
    RECEIVED: { label: "Recibida", tone: "success" },
    CANCELLED: { label: "Cancelada", tone: "danger" },
  },
  loan: {
    OPEN: { label: "Abierto", tone: "primary" },
    CLOSED: { label: "Cerrado", tone: "success" },
    CANCELLED: { label: "Cancelado", tone: "danger" },
  },
  // The WhatsApp session drifts on its own: the provider state machine is the
  // source, and the ones that wait for the operator (scan, passkey) carry the
  // warning tone because the channel does nothing until they are answered.
  "whatsapp-session": {
    STOPPED: { label: "Detenido", tone: "default" },
    STARTING: { label: "Iniciando", tone: "primary" },
    SCAN_QR_CODE: { label: "Esperando QR", tone: "warning" },
    PASSKEY_REQUIRED: { label: "Requiere passkey", tone: "warning" },
    PASSKEY_CONFIRMATION_REQUIRED: { label: "Confirmar passkey", tone: "warning" },
    WORKING: { label: "Conectado", tone: "success" },
    FAILED: { label: "No se pudo conectar", tone: "danger" },
  },
  // One linked number: a link that is not confirmed yet waits on nobody but the
  // person holding the phone, and a revoked one is simply inert.
  "whatsapp-identity": {
    PENDING: { label: "Pendiente", tone: "warning" },
    VERIFIED: { label: "Verificado", tone: "success" },
    REVOKED: { label: "Revocado", tone: "default" },
  },
  // One attempt of the daily report: "en curso" is work in flight, not a
  // degraded state, so it reads as primary and not as a warning.
  "whatsapp-delivery": {
    PENDING: { label: "En curso", tone: "primary" },
    SENT: { label: "Enviado", tone: "success" },
    FAILED: { label: "Falló", tone: "danger" },
  },
  // What the server answered to a manual send, told as it happened: an attempt
  // that lost the daily claim was not sent again, and that is not an error.
  "whatsapp-report": {
    SENT: { label: "Enviado", tone: "success" },
    FAILED: { label: "Falló", tone: "danger" },
    ALREADY_ATTEMPTED: { label: "Ya intentado", tone: "warning" },
  },
};

export function statusMeta(domain: StatusDomain, status: string): StatusMeta {
  const known = STATUS_META[domain][status];
  if (known) return known;
  // An expense that is not fully paid is partially paid by definition.
  if (domain === "expense") return { label: "Parcial", tone: "warning" };
  return { label: status, tone: "default" };
}

export function StatusBadge({
  domain,
  status,
  dot = true,
  className,
}: {
  domain: StatusDomain;
  status: string;
  dot?: boolean;
  className?: string;
}) {
  const meta = statusMeta(domain, status);
  return (
    <Badge variant={meta.tone} dot={dot} className={className}>
      {meta.label}
    </Badge>
  );
}
