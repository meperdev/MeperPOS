"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import type { PurchaseOrderStatus } from "@/types";

export function PurchaseOrderStatusBadge({
  status,
  className,
}: {
  status: PurchaseOrderStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      domain="purchase-order"
      status={status}
      className={className}
    />
  );
}
