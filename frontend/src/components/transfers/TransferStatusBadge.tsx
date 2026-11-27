"use client";

import { Badge } from "@/components/ui/Badge";
import type { StockTransferStatus } from "@/types";

/**
 * A transfer's state, told with text + colour + dot. Only an in-transit
 * transfer can still be received or cancelled, so its tone is the one that asks
 * for attention.
 */
const STATUS_META: Record<
  StockTransferStatus,
  { label: string; variant: "warning" | "success" | "danger" }
> = {
  IN_TRANSIT: { label: "En tránsito", variant: "warning" },
  RECEIVED: { label: "Recibida", variant: "success" },
  CANCELLED: { label: "Cancelada", variant: "danger" },
};

export function TransferStatusBadge({
  status,
  className,
}: {
  status: StockTransferStatus;
  className?: string;
}) {
  const meta = STATUS_META[status] ?? {
    label: status,
    variant: "warning" as const,
  };
  return (
    <Badge variant={meta.variant} dot className={className}>
      {meta.label}
    </Badge>
  );
}
