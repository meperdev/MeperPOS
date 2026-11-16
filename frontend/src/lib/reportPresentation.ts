import { formatCurrency, toFiniteNumber } from "@/lib/utils";
import type { DailyReport, DailyReportSale } from "@/types";

export type ReportGranularity = "day" | "month";

const BOGOTA_TIME_ZONE = "America/Bogota";

const bogotaClockFormatter = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: BOGOTA_TIME_ZONE,
});

const bogotaDayLabelFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "long",
  timeZone: BOGOTA_TIME_ZONE,
});

/** Kept as the report-facing alias; the single implementation lives in utils. */
export function safeDecimalNumber(value: string | number | null | undefined) {
  return toFiniteNumber(value);
}

export function formatReportMoney(value: string | number | null | undefined) {
  return formatCurrency(safeDecimalNumber(value));
}

/** Bogotá wall-clock time for an instant, e.g. "13:42". */
export function formatReportClockTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return bogotaClockFormatter.format(parsed);
}

/** Bogotá calendar day for a `YYYY-MM-DD` value, e.g. "15 de marzo". */
export function formatReportDayLabel(value: string | null | undefined) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  return bogotaDayLabelFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function adaptiveReportGranularity(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): ReportGranularity {
  if (!startDate || !endDate) return "month";
  const start = Date.parse(`${startDate}T12:00:00Z`);
  const end = Date.parse(`${endDate}T12:00:00Z`);
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  return days <= 31 ? "day" : "month";
}

export type DailyReportPendingKey = "lowStock" | "purchaseOrders" | "loans";

export interface DailyReportPendingItem {
  key: DailyReportPendingKey;
  label: string;
  href: string;
  count: number;
  /** At most three display-ready examples, in the order the server sent them. */
  sample: string[];
  /** Examples left out of `sample`. */
  remaining: number;
}

const PENDING_SAMPLE_SIZE = 3;

/**
 * The pending work of the daily report, in the order the operator acts on it.
 * Groups with nothing pending are dropped so the block never renders an empty row.
 */
export function dailyReportPendingItems(
  report: Pick<DailyReport, "lowStock" | "purchaseOrders" | "loans">,
): DailyReportPendingItem[] {
  const build = (
    key: DailyReportPendingKey,
    label: string,
    href: string,
    values: string[],
  ): DailyReportPendingItem => ({
    key,
    label,
    href,
    count: values.length,
    sample: values.slice(0, PENDING_SAMPLE_SIZE),
    remaining: Math.max(0, values.length - PENDING_SAMPLE_SIZE),
  });

  return [
    build(
      "lowStock",
      "Productos con stock bajo",
      "/inventory",
      report.lowStock.map((product) => `${product.name} · ${product.stock} en stock`),
    ),
    build(
      "purchaseOrders",
      "Órdenes de compra pendientes",
      "/purchase-orders",
      report.purchaseOrders.map(
        (order) => `${order.supplier?.name ?? "Sin proveedor"} · #${order.orderNumber}`,
      ),
    ),
    build(
      "loans",
      "Préstamos vencidos o por vencer",
      "/loans",
      report.loans.map((loan) => {
        const holder = loan.customer ?? loan.supplier ?? "Sin contraparte";
        return `${holder} · ${formatReportMoney(loan.balance)}`;
      }),
    ),
  ].filter((item) => item.count > 0);
}

export interface DailyReportSaleRow {
  id: string;
  saleNumber: number;
  time: string;
  customerLabel: string;
  /** Decimal string exactly as the server sent it; format it at render time. */
  total: string;
}

/** Today's sales, newest first, with the walk-in bucket named explicitly. */
export function dailyReportSalesRows(sales: DailyReportSale[]): DailyReportSaleRow[] {
  return [...sales]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((sale) => ({
      id: sale.id,
      saleNumber: sale.saleNumber,
      time: formatReportClockTime(sale.createdAt),
      customerLabel: sale.customer?.name ?? "Sin cliente",
      total: sale.total,
    }));
}
