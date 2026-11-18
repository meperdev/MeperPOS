"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import type { PurchaseOrderStatus } from "@/types";

/**
 * The order status, read as the user tracks it: a pending order that already
 * went to the supplier reads "Enviada", and an overdue order (server-computed)
 * carries a second "Atrasada" badge.
 */
export function PurchaseOrderStatusBadge({
  status,
  sent = false,
  overdue = false,
  className,
}: {
  status: PurchaseOrderStatus;
  sent?: boolean;
  overdue?: boolean;
  className?: string;
}) {
  const shown = status === "PENDING" && sent ? "SENT" : status;
  // One inline group, so a flex parent that spaces its children apart keeps
  // both badges together.
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge
        domain="purchase-order"
        status={shown}
        className={className}
      />
      {overdue ? (
        <StatusBadge
          domain="purchase-order"
          status="OVERDUE"
          className={className}
        />
      ) : null}
    </span>
  );
}
