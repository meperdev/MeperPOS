import { describe, expect, it } from "vitest";
import { isTaskOverdue } from "./task-due";

/**
 * `Task.dueDate` carries two shapes: the tasks page stores the picked calendar
 * day at midnight UTC, while the API also accepts a real instant. A day-shaped
 * value is a day, not the instant that day begins, so it must not turn
 * "Vencida" at 19:00 in Bogotá — five hours before its own day starts. This
 * mirrors `backend/src/tasks/task-due.ts` exactly.
 */
describe("task overdue rule", () => {
  // 2026-11-20T02:00Z is 21:00 on 19 November in Bogotá.
  const lateEvening = new Date("2026-11-20T02:00:00.000Z");
  // 2026-11-20T05:30Z is 00:30 on 20 November in Bogotá.
  const afterMidnight = new Date("2026-11-20T05:30:00.000Z");

  it("does not flag a day-shaped task due today at 21:00 in Bogotá", () => {
    expect(isTaskOverdue("2026-11-19T00:00:00.000Z", lateEvening)).toBe(false);
  });

  it("flags that same day-shaped task once the shop is on the next day", () => {
    expect(isTaskOverdue("2026-11-19T00:00:00.000Z", afterMidnight)).toBe(true);
  });

  it("does not flag a day-shaped task whose day is still today after midnight", () => {
    expect(isTaskOverdue("2026-11-20T00:00:00.000Z", afterMidnight)).toBe(false);
  });

  it("flags a day-shaped task from an earlier calendar day", () => {
    expect(isTaskOverdue("2026-11-18T00:00:00.000Z", lateEvening)).toBe(true);
  });

  it("compares a task with a real time of day against the instant", () => {
    const dueAt = "2026-11-19T15:00:00.000Z";

    expect(isTaskOverdue(dueAt, new Date("2026-11-19T16:00:00.000Z"))).toBe(
      true,
    );
    expect(isTaskOverdue(dueAt, new Date("2026-11-19T14:00:00.000Z"))).toBe(
      false,
    );
  });

  it("does not flag a task whose exact instant is now", () => {
    expect(
      isTaskOverdue(
        "2026-11-19T15:00:00.000Z",
        new Date("2026-11-19T15:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("reads a Date and an ISO string the same way", () => {
    const due = new Date("2026-11-18T00:00:00.000Z");

    expect(isTaskOverdue(due, lateEvening)).toBe(
      isTaskOverdue(due.toISOString(), lateEvening),
    );
  });

  it("defaults to the current instant", () => {
    // A due date in the past stays overdue without an explicit clock.
    expect(isTaskOverdue(new Date("2020-01-01T00:00:00.000Z"))).toBe(true);
  });
});
