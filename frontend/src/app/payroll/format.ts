import { formatDate, toFiniteNumber } from "@/lib/utils";

// The server owns every payroll amount and sends it as a decimal string. COP
// normally prints without cents, but payroll abonos carry them (the routes accept
// up to two decimals), so this is the page's only money formatter and it keeps
// both digits: rounding here would misstate what the server stored.
const PAYROLL_MONEY = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function payrollMoney(value: string): string {
  return PAYROLL_MONEY.format(toFiniteNumber(value));
}

/**
 * Payroll dates are stored date-only and travel either as `YYYY-MM-DD` or as a
 * UTC-midnight stamp. A calendar day has no timezone, so the stored day is read
 * at local noon and printed by the canonical formatter — parsing it at midnight
 * would show the previous day in Bogotá.
 */
export function payrollDate(value: string): string {
  return formatDate(new Date(`${value.slice(0, 10)}T12:00:00`));
}

/**
 * Integer cents of a server decimal string. Only the replacement preview adds
 * money values, and it adds them as bigints so exact decimal strings never pass
 * through floating point. A string the preview cannot represent contributes
 * zero instead of throwing while the dialog renders.
 */
export function payrollCents(value: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return BigInt(0);
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const negative = whole.startsWith("-");
  const digits = `${whole.replace("-", "") || "0"}${fraction.padEnd(2, "0").slice(0, 2)}`;
  return BigInt(`${negative ? "-" : ""}${digits}`);
}

/** Print an integer cents total through the same formatter as every amount. */
export function payrollCentsToMoney(cents: bigint): string {
  const negative = cents < BigInt(0);
  const absolute = negative ? -cents : cents;
  const decimal = `${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
  return payrollMoney(negative ? `-${decimal}` : decimal);
}

/**
 * The stat strip aggregates the server's per-obligation `summary` values. It
 * adds server-owned decimal strings exactly, and never re-prices an obligation's
 * installments.
 */
export function sumServerAmounts(values: readonly string[]): string {
  return payrollCentsToMoney(
    values.reduce((total, value) => total + payrollCents(value), BigInt(0)),
  );
}
