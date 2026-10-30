"use client";

import { Badge } from "@/components/ui/Badge";

/**
 * One map for every status the app paints. A status badge is text + colour +
 * dot (never colour alone), and every surface resolves the same string to the
 * same tone: sales, expenses, purchase orders and loans.
 */
export type StatusDomain = "sale" | "expense" | "purchase-order" | "loan";

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
