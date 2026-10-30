"use client";

import { Badge } from "@/components/ui/Badge";
import type { PurchaseOrderStatus } from "@/types";

const statusConfig: Record<
  PurchaseOrderStatus,
  {
    label: string;
    variant: "default" | "primary" | "warning" | "success" | "danger";
  }
> = {
  DRAFT: {
    label: "Borrador",
    variant: "default",
  },
  PENDING: {
    label: "Pendiente",
    variant: "primary",
  },
  PARTIAL_RECEIVED: {
    label: "Recibida parcial",
    variant: "warning",
  },
  RECEIVED: {
    label: "Recibida",
    variant: "success",
  },
  CANCELLED: {
    label: "Cancelada",
    variant: "danger",
  },
};

export function PurchaseOrderStatusBadge({
  status,
  className,
}: {
  status: PurchaseOrderStatus;
  className?: string;
}) {
  const cfg = statusConfig[status];
  return (
    <Badge variant={cfg.variant} dot className={className}>
      {cfg.label}
    </Badge>
  );
}
