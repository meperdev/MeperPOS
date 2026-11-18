import type { PurchaseOrderStatus } from '@prisma/client';
import { formatDateInBogota } from '../common/utils/bogota-date';

/**
 * Orders still waiting for goods. The daily report counts these as pending and
 * the purchase-order list filters them with `status=OPEN`, so both read the
 * same set.
 */
export const OPEN_PURCHASE_ORDER_STATUSES = [
  'PENDING',
  'PARTIAL_RECEIVED',
] as const satisfies readonly PurchaseOrderStatus[];

/**
 * Today's calendar day in Bogotá, as the value Prisma returns for a
 * `@db.Date` column (midnight UTC). An expected delivery date earlier than this
 * has passed.
 */
export function bogotaToday(now: Date = new Date()): Date {
  return new Date(`${formatDateInBogota(now)}T00:00:00.000Z`);
}

/** Parses a `YYYY-MM-DD` calendar day into the value stored in a `@db.Date` column. */
export function toCalendarDay(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/**
 * An order is overdue while it still waits for goods and its expected delivery
 * day is before today in Bogotá. The list filter (`status=OVERDUE`) and this
 * flag read the same rule.
 */
export function isPurchaseOrderOverdue(
  order: { status: string; expectedDeliveryDate?: Date | null },
  today: Date = bogotaToday(),
): boolean {
  if (!order.expectedDeliveryDate) return false;
  if (
    !(OPEN_PURCHASE_ORDER_STATUSES as readonly string[]).includes(order.status)
  ) {
    return false;
  }
  return order.expectedDeliveryDate.getTime() < today.getTime();
}
