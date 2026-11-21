import { describe, expect, it } from "vitest";
import { formatCalendarDay, formatCalendarDayShort } from "@/lib/utils";

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

describe("formatCalendarDayShort (calendar days in dense card cells)", () => {
  it("names the stored day in the compact label the tables read", () => {
    expect(formatCalendarDayShort("2026-11-25T00:00:00.000Z")).toBe(
      "25 nov 2026",
    );
    expect(formatCalendarDayShort("2026-01-01T00:00:00.000Z")).toBe("1 ene 2026");
    expect(formatCalendarDayShort("2026-12-31T00:00:00.000Z")).toBe(
      "31 dic 2026",
    );
  });

  it("never slips to the previous day for a midnight-UTC calendar day", () => {
    const midnightUtc = "2026-11-16T00:00:00.000Z";

    // The compact label names exactly the day the long UTC-pinned wording does.
    expect(formatCalendarDayShort(midnightUtc)).toBe(
      formatCalendarDay(midnightUtc).replace(" de noviembre de ", " nov "),
    );
    expect(formatCalendarDayShort(midnightUtc)).not.toBe("15 nov 2026");
  });

  it("keeps the ICU spelling of September and leaves no period after the month", () => {
    const formatted = formatCalendarDayShort("2026-09-09T00:00:00.000Z");

    expect(formatted).toBe("9 sept 2026");
    expect(formatted).not.toMatch(/sept?\./);
  });
});
