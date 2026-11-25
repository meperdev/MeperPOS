import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { CURRENCY, LOCALE, TIMEZONE } from "@/lib/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = CURRENCY) {
  const isCop = currency.toUpperCase() === CURRENCY;

  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: isCop ? 0 : 2,
    maximumFractionDigits: isCop ? 0 : 2,
  }).format(isCop ? Math.round(amount) : amount);
}

/**
 * Canonical coercion for values that may arrive as a Prisma `Decimal` string.
 * The backend serializes `Decimal` columns as JSON strings (`"15000.00"`), and
 * `Number.isFinite` does NOT coerce strings, so raw string values fail numeric
 * guards and inflate digit-only formatters. Every Decimal-backed read must pass
 * through this helper: non-finite or absent values collapse to 0.
 */
export function toFiniteNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat(LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

/**
 * Formats a calendar day stored as midnight UTC (a `@db.Date` column) as that
 * same day, whatever the browser's time zone.
 */
export function formatCalendarDay(date: string | Date) {
  return new Intl.DateTimeFormat(LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

/**
 * The day-only label a dense row reads at a glance: "16 nov 2026".
 *
 * `formatDate` is the prose wording ("16 de noviembre de 2026") that belongs in
 * a sentence or a document detail; inside a table cell it pushes the row onto a
 * second line. Same zone semantics as `formatDate` (the value's own day, not
 * `formatCalendarDay`'s UTC pinning), same ICU month abbreviation as
 * `formatDateTime`, trailing period removed.
 */
const compactDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** Same compact day label, pinned to UTC the way `formatCalendarDay` is. */
const compactCalendarDayFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** The one place a compact day label is assembled, so every one stays identical. */
function dayLabelFromParts(parts: Intl.DateTimeFormatPart[]): string {
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const month = pick("month").replace(/\.$/, "");

  return `${pick("day")} ${month} ${pick("year")}`.trim();
}

function compactDayLabel(
  formatter: Intl.DateTimeFormat,
  date: string | Date,
): string {
  return dayLabelFromParts(formatter.formatToParts(new Date(date)));
}

export function formatDateShort(date: string | Date) {
  return compactDayLabel(compactDateFormatter, date);
}

/**
 * The compact label for a calendar day stored as midnight UTC (a `@db.Date`
 * column), read as that same day whatever the browser's time zone — the shape
 * `formatCalendarDay` owns, in the day-only wording tables and card cells use.
 */
export function formatCalendarDayShort(date: string | Date) {
  return compactDayLabel(compactCalendarDayFormatter, date);
}

/**
 * The compact date-time a UI row reads at a glance: "16 nov 2026, 4:21 p. m.".
 *
 * Intl joins es-CO short-month dates with " de " and separates the time with
 * " a las ", which turns every table cell into a sentence; the parts are
 * reassembled here so a dense table keeps one scan line. The month keeps the
 * ICU abbreviation (four letters in September) and loses any trailing period,
 * the hour rides the 12-hour clock without a leading zero, and the day period's
 * narrow space becomes a plain one.
 *
 * Printed documents and message texts keep the long wording through
 * `formatDateTimeLong` — never this one.
 */
const compactDateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatDateTime(date: string | Date) {
  const parts = compactDateTimeFormatter.formatToParts(new Date(date));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const dayPeriod = pick("dayPeriod").replace(/[\u00a0\u202f]/g, " ");
  const datePart = dayLabelFromParts(parts);
  const timePart = `${pick("hour")}:${pick("minute")}`;

  return `${datePart}, ${timePart} ${dayPeriod}`.trimEnd();
}

/**
 * The long wording a document or a message keeps: "16 de noviembre de 2026 a
 * las 04:21 p. m.". Receipt previews, exported copy and WhatsApp texts read as
 * prose, so they take this one and the UI takes `formatDateTime`.
 */
export function formatDateTimeLong(date: string | Date) {
  return new Intl.DateTimeFormat(LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

const bogotaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getBogotaDateInputValue(date: Date = new Date()) {
  const parts = bogotaDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return date.toISOString().split("T")[0];
  }

  return `${year}-${month}-${day}`;
}

export function shiftDateInputValue(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split("-").map(Number);

  if (!year || !month || !day) {
    return dateValue;
  }

  const shiftedDate = new Date(Date.UTC(year, month - 1, day));
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + days);

  const nextYear = shiftedDate.getUTCFullYear();
  const nextMonth = String(shiftedDate.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(shiftedDate.getUTCDate()).padStart(2, "0");

  return `${nextYear}-${nextMonth}-${nextDay}`;
}

/**
 * Safe localStorage helpers.
 * localStorage throws in incognito/private browsing (Safari, Firefox),
 * when quota is exceeded, or when disabled.
 */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Silently fail — quota exceeded or private browsing
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Silently fail
  }
}

/**
 * Derives the opt-in tax fields for a product from the entered tax-rate input.
 * A positive rate keeps the product taxable; 0 or an empty field marks it NOT
 * taxable (the backend forces the stored rate to 0). This prevents sending
 * `taxable: true` with a 0 rate, which the backend rejects and would silently
 * leave the old rate in place.
 */
export function resolveTaxFields(
  taxRateInput: string,
): { taxable: boolean; taxRate: number } {
  const trimmed = taxRateInput.trim();
  if (trimmed === "") {
    return { taxable: false, taxRate: 0 };
  }
  const value = Number(trimmed);
  if (value > 0) {
    return { taxable: true, taxRate: value };
  }
  return { taxable: false, taxRate: 0 };
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  MIXED: "Mixto",
  CREDIT: "Crédito",
};

export function formatPaymentMethod(method?: string | null): string {
  if (!method) return "Sin pago";
  const normalized = method.toUpperCase().trim();
  return PAYMENT_METHOD_LABELS[normalized] ?? method;
}

