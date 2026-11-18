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

export function formatDateTime(date: string | Date) {
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

