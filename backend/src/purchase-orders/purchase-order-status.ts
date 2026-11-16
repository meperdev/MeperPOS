import type { PurchaseOrderStatus } from '@prisma/client';

/**
 * Orders still waiting for goods. The daily report counts these as pending and
 * the purchase-order list filters them with `status=OPEN`, so both read the
 * same set.
 */
export const OPEN_PURCHASE_ORDER_STATUSES = [
  'PENDING',
  'PARTIAL_RECEIVED',
] as const satisfies readonly PurchaseOrderStatus[];
