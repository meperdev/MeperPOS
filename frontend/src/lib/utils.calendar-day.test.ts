import { describe, expect, it } from "vitest";
import { formatCalendarDay } from "@/lib/utils";

describe("formatCalendarDay", () => {
  // A @db.Date arrives as midnight UTC; in Bogotá (UTC-5) a plain date
  // formatter would show the previous day.
  it("keeps the stored day for a midnight-UTC calendar day", () => {
    expect(formatCalendarDay("2026-11-25T00:00:00.000Z")).toBe(
      "25 de noviembre de 2026",
    );
    expect(formatCalendarDay("2026-01-01T00:00:00.000Z")).toBe(
      "1 de enero de 2026",
    );
    expect(formatCalendarDay("2026-12-31T00:00:00.000Z")).toBe(
      "31 de diciembre de 2026",
    );
  });
});
