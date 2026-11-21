import { bogotaToday } from '../purchase-orders/purchase-order-status';

/**
 * Whether a stored `dueDate` is exactly midnight UTC, the shape a calendar day
 * takes. The tasks page sends the picked day as `new Date(day).toISOString()`,
 * so such a value marks a day, not the instant that day starts.
 */
function isDayShaped(dueDate: Date): boolean {
  return (
    dueDate.getUTCHours() === 0 &&
    dueDate.getUTCMinutes() === 0 &&
    dueDate.getUTCSeconds() === 0 &&
    dueDate.getUTCMilliseconds() === 0
  );
}

/**
 * Whether an open task is past its due date at `now`.
 *
 * `Task.dueDate` holds two shapes and each is read the way it was written: a
 * day-shaped value (midnight UTC) is overdue only once its calendar day is
 * behind today in Bogotá, while a value with a real time of day — the API takes
 * a `@IsDateString()` instant and the seeds store one — is overdue once that
 * instant passes. Comparing both against the current instant alone declared a
 * task due today overdue from 19:00 in Bogotá, five hours before its own day
 * began.
 *
 * The caller still owns the "open" half of the rule (not completed, not
 * cancelled); this function only reads the date.
 */
export function isTaskOverdue(dueDate: Date, now: Date): boolean {
  if (isDayShaped(dueDate)) {
    return dueDate.getTime() < bogotaToday(now).getTime();
  }
  return dueDate.getTime() < now.getTime();
}
