import { getBogotaDateInputValue } from "@/lib/utils";

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
 * Whether an open task is past its due date at `now` — the same rule the alert
 * feed applies in `backend/src/tasks/task-due.ts`, so the badge and the bell
 * agree on any given task.
 *
 * `Task.dueDate` holds two shapes and each is read the way it was written: a
 * day-shaped value (midnight UTC) is overdue only once its calendar day is
 * behind today's business day (`TIMEZONE`), while a value with a real time of
 * day is overdue once that instant passes. Comparing both against the current
 * instant alone marked a task due today overdue from 19:00 in Bogotá, five
 * hours before its own day began.
 *
 * The caller still owns the "open" half of the rule (not completed, not
 * cancelled); this function only reads the date.
 */
export function isTaskOverdue(
  dueDate: string | Date,
  now: Date = new Date(),
): boolean {
  const due = new Date(dueDate);

  if (isDayShaped(due)) {
    return due.toISOString().slice(0, 10) < getBogotaDateInputValue(now);
  }

  return due.getTime() < now.getTime();
}
