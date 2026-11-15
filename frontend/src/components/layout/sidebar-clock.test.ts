import { describe, it, expect } from "vitest";
import { formatSidebarClock } from "./sidebar-clock";

describe("formatSidebarClock", () => {
  it("renders the weekday, day, month and time on one line in es-CO", () => {
    // Sunday 15 Nov 2026, 17:25 local time.
    const date = new Date(2026, 10, 15, 17, 25);

    expect(formatSidebarClock(date)).toBe("dom 15 nov · 5:25 p. m.");
  });

  it("uses regular spaces even though Intl emits non-breaking spaces", () => {
    const date = new Date(2026, 10, 15, 17, 25);

    expect(formatSidebarClock(date)).not.toMatch(/ | /);
  });

  it("formats morning hours with a.m. and no leading zero on the hour", () => {
    const date = new Date(2026, 10, 15, 9, 5);

    expect(formatSidebarClock(date)).toBe("dom 15 nov · 9:05 a. m.");
  });
});
