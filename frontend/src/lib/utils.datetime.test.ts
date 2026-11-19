import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDateTimeLong, formatDateShort } from "@/lib/utils";

// Local dates are built with the `Date(y, m, d, h, min)` constructor so the
// pinned strings hold whatever time zone the runner sits in; the formatter
// itself reads the browser's zone, which is the point of the compact wording.
describe("formatDateTime (compact wording for UI rows)", () => {
  it("abbreviates the month and drops the 'a las' the long form uses", () => {
    const date = new Date(2026, 10, 16, 16, 21);

    expect(formatDateTime(date)).toBe("16 nov 2026, 4:21 p. m.");
  });

  it("takes the ISO strings the API returns", () => {
    const date = new Date(2026, 10, 16, 16, 21);

    expect(formatDateTime(date.toISOString())).toBe("16 nov 2026, 4:21 p. m.");
  });

  it("keeps a bare hour and pads the minutes", () => {
    expect(formatDateTime(new Date(2026, 0, 5, 9, 5))).toBe(
      "5 ene 2026, 9:05 a. m.",
    );
  });

  it("keeps the ICU spelling of September and leaves no period after the month", () => {
    const formatted = formatDateTime(new Date(2026, 8, 9, 23, 9));

    expect(formatted).toBe("9 sept 2026, 11:09 p. m.");
    expect(formatted).not.toMatch(/sept?\./);
  });

  it("reads midnight and noon as 12", () => {
    expect(formatDateTime(new Date(2026, 10, 16, 0, 7))).toBe(
      "16 nov 2026, 12:07 a. m.",
    );
    expect(formatDateTime(new Date(2026, 10, 16, 12, 0))).toBe(
      "16 nov 2026, 12:00 p. m.",
    );
  });

  it("uses regular spaces even though Intl emits narrow ones in the day period", () => {
    expect(formatDateTime(new Date(2026, 10, 16, 16, 21))).not.toMatch(
      /[\u00a0\u202f]/,
    );
  });
});

describe("formatDateShort (day-only cells in dense rows)", () => {
  it("abbreviates the month and drops the 'de' the long form joins with", () => {
    expect(formatDateShort(new Date(2026, 10, 16))).toBe("16 nov 2026");
  });

  it("takes the ISO strings the API returns", () => {
    expect(formatDateShort(new Date(2026, 10, 16).toISOString())).toBe(
      "16 nov 2026",
    );
  });

  it("keeps the ICU spelling of September and leaves no period after the month", () => {
    const formatted = formatDateShort(new Date(2026, 8, 9));

    expect(formatted).toBe("9 sept 2026");
    expect(formatted).not.toMatch(/sept?\./);
  });

  it("keeps exactly the day the long form already shows", () => {
    // The shift from prose to a compact label is wording only; a calendar date
    // stored as midnight UTC must not move to another day.
    const midnightUtc = "2026-11-16T00:00:00.000Z";

    expect(formatDateShort(midnightUtc)).toBe(
      formatDate(midnightUtc).replace(" de noviembre de ", " nov "),
    );
  });

  it("uses regular spaces even though Intl may emit narrow ones", () => {
    expect(formatDateShort(new Date(2026, 10, 16))).not.toMatch(
      /[\u00a0\u202f]/,
    );
  });
});

describe("formatDateTimeLong (documents and messages)", () => {
  it("keeps the long month and the 'a las' wording a printed document reads with", () => {
    expect(formatDateTimeLong(new Date(2026, 10, 16, 16, 21))).toBe(
      "16 de noviembre de 2026 a las 04:21 p. m.",
    );
  });

  it("takes the ISO strings the API returns", () => {
    const date = new Date(2026, 0, 5, 9, 5);

    expect(formatDateTimeLong(date.toISOString())).toBe(
      "5 de enero de 2026 a las 09:05 a. m.",
    );
  });
});
