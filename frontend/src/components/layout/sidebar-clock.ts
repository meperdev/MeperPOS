const LOCALE = "es-CO";

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * One-line footer clock: "dom 15 nov · 5:25 p. m.".
 *
 * Intl separates the date parts with ", de " and the day period with a
 * non-breaking space; the footer wants a plain, single-spaced line.
 */
export function formatSidebarClock(date: Date): string {
  const dateParts = dateFormatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    dateParts.find((part) => part.type === type)?.value ?? "";
  const datePart = `${pick("weekday")} ${pick("day")} ${pick("month")}`;

  const time = timeFormatter.format(date).replace(/[  ]/g, " ");

  return `${datePart} · ${time}`;
}
