import { isTaskOverdue } from './task-due';

/**
 * `Task.dueDate` carries two shapes: the tasks page stores the picked calendar
 * day at midnight UTC, while the API accepts a real instant (`@IsDateString`)
 * and the seeds store a time of day. A day-shaped value is a day, not the
 * instant that day begins, so it must not turn "vencida" at 19:00 in Bogotá —
 * five hours before its own day starts.
 */
describe('task overdue rule', () => {
  // 2026-11-20T02:00Z is 21:00 on 19 November in Bogotá.
  const lateEvening = new Date('2026-11-20T02:00:00.000Z');
  // 2026-11-20T05:30Z is 00:30 on 20 November in Bogotá.
  const afterMidnight = new Date('2026-11-20T05:30:00.000Z');

  it('does not flag a day-shaped task due today at 21:00 in Bogotá', () => {
    const dueToday = new Date('2026-11-19T00:00:00.000Z');

    expect(isTaskOverdue(dueToday, lateEvening)).toBe(false);
  });

  it('flags that same day-shaped task once the shop is on the next day', () => {
    const dueToday = new Date('2026-11-19T00:00:00.000Z');

    expect(isTaskOverdue(dueToday, afterMidnight)).toBe(true);
  });

  it('does not flag a day-shaped task whose day is still today after midnight', () => {
    const dueToday = new Date('2026-11-20T00:00:00.000Z');

    expect(isTaskOverdue(dueToday, afterMidnight)).toBe(false);
  });

  it('flags a day-shaped task from an earlier calendar day', () => {
    const dueYesterday = new Date('2026-11-18T00:00:00.000Z');

    expect(isTaskOverdue(dueYesterday, lateEvening)).toBe(true);
  });

  it('compares a task with a real time of day against the instant', () => {
    const dueAt = new Date('2026-11-19T15:00:00.000Z');

    expect(isTaskOverdue(dueAt, new Date('2026-11-19T16:00:00.000Z'))).toBe(
      true,
    );
    expect(isTaskOverdue(dueAt, new Date('2026-11-19T14:00:00.000Z'))).toBe(
      false,
    );
  });

  it('does not flag a task whose exact instant is now', () => {
    const dueAt = new Date('2026-11-19T15:00:00.000Z');

    expect(isTaskOverdue(dueAt, new Date('2026-11-19T15:00:00.000Z'))).toBe(
      false,
    );
  });
});
