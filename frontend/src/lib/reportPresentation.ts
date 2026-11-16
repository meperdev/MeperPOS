import { formatCurrency, shiftDateInputValue, toFiniteNumber } from "@/lib/utils";
import type {
  CustomerStatistics,
  DailyReport,
  DailyReportSale,
  FinancialProductMargin,
} from "@/types";

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

/** How loud the status dot of a pending chip is; the label never depends on it. */
export type DailyReportPendingSeverity = "danger" | "warning" | "info";

export interface DailyReportPendingChip {
  id: string;
  /** What the item is: product, order plus supplier, or holder plus balance. */
  label: string;
  /** The key value the operator acts on: stock vs minimum, status, or due date. */
  value: string;
  severity: DailyReportPendingSeverity;
}

export interface DailyReportPendingItem {
  key: DailyReportPendingKey;
  label: string;
  href: string;
  count: number;
  /** At most three display-ready chips, in the order the server sent them. */
  chips: DailyReportPendingChip[];
  /** Items left out of `chips`. */
  remaining: number;
}

const PENDING_SAMPLE_SIZE = 3;

const bogotaShortMonthFormatter = new Intl.DateTimeFormat("es-CO", {
  month: "short",
  timeZone: BOGOTA_TIME_ZONE,
});

/** The calendar day of a `YYYY-MM-DD` value or of an ISO instant, never shifted. */
function reportCalendarDay(value: string) {
  return value.slice(0, 10);
}

/** Bogotá day and short month, e.g. "18 nov" — the deadline reading of a chip. */
export function formatReportShortDay(value: string | null | undefined) {
  if (!value) return "";
  const [year, month, day] = reportCalendarDay(value).split("-").map(Number);
  if (!year || !month || !day) return "";
  const monthLabel = bogotaShortMonthFormatter
    .format(new Date(Date.UTC(year, month - 1, day, 12)))
    .replace(/\.$/, "");
  return `${day} ${monthLabel}`;
}

/** A loan is late once its day is behind the report day, and due soon otherwise. */
function loanDue(
  dueAt: string | null,
  reportDay: string,
): { value: string; severity: DailyReportPendingSeverity } {
  const day = dueAt ? reportCalendarDay(dueAt) : "";
  if (!day) return { value: "sin fecha", severity: "warning" };
  if (day < reportDay) {
    return { value: `venció ${formatReportShortDay(day)}`, severity: "danger" };
  }
  if (day === reportDay) return { value: "vence hoy", severity: "warning" };
  return { value: `vence ${formatReportShortDay(day)}`, severity: "warning" };
}

const PURCHASE_ORDER_CHIP: Record<
  string,
  { value: string; severity: DailyReportPendingSeverity }
> = {
  PENDING: { value: "Pendiente", severity: "warning" },
  PARTIAL_RECEIVED: { value: "Parcial", severity: "info" },
};

/** An order that is neither pending nor partially received is still open work. */
const OPEN_ORDER_FALLBACK = { value: "Por recibir", severity: "warning" } as const;

/**
 * The pending work of the daily report, in the order the operator acts on it.
 * Each group carries at most three chips and the count of the rest; groups with
 * nothing pending are dropped so the grid never renders an empty card.
 */
export function dailyReportPendingItems(
  report: Pick<DailyReport, "date" | "lowStock" | "purchaseOrders" | "loans">,
): DailyReportPendingItem[] {
  const reportDay = reportCalendarDay(report.date);

  const build = (
    key: DailyReportPendingKey,
    label: string,
    href: string,
    chips: DailyReportPendingChip[],
  ): DailyReportPendingItem => ({
    key,
    label,
    href,
    count: chips.length,
    chips: chips.slice(0, PENDING_SAMPLE_SIZE),
    remaining: Math.max(0, chips.length - PENDING_SAMPLE_SIZE),
  });

  return [
    build(
      "lowStock",
      "Productos con stock bajo",
      "/inventory?filter=lowStock",
      report.lowStock.map((product) => ({
        id: product.id,
        label: product.name,
        value: `${product.stock} / mín ${product.minStock}`,
        severity: product.stock <= 0 ? "danger" : "warning",
      })),
    ),
    build(
      "purchaseOrders",
      "Órdenes de compra pendientes",
      "/purchase-orders?status=OPEN",
      report.purchaseOrders.map((order) => {
        const status = PURCHASE_ORDER_CHIP[order.status] ?? OPEN_ORDER_FALLBACK;
        return {
          id: order.id,
          label: `#${order.orderNumber} · ${order.supplier?.name ?? "Sin proveedor"}`,
          value: status.value,
          severity: status.severity,
        };
      }),
    ),
    build(
      "loans",
      "Préstamos vencidos o por vencer",
      "/loans",
      report.loans.map((loan) => {
        const holder = loan.customer ?? loan.supplier ?? "Sin contraparte";
        return {
          id: loan.id,
          label: `${holder} · ${formatReportMoney(loan.balance)}`,
          ...loanDue(loan.dueAt, reportDay),
        };
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

export type ReportPeriodPresetId = "today" | "last7" | "thisMonth" | "last30";

export interface ReportPeriodPreset {
  id: ReportPeriodPresetId;
  label: string;
  startDate: string;
  endDate: string;
}

/**
 * Every preset resolves to an explicit `YYYY-MM-DD` window, so the page never
 * falls back to an ambiguous "all time" range whose meaning differs per endpoint.
 */
export function reportPeriodPresets(todayValue: string): ReportPeriodPreset[] {
  const monthStart = `${todayValue.slice(0, 7)}-01`;

  return [
    { id: "today", label: "Hoy", startDate: todayValue, endDate: todayValue },
    {
      id: "last7",
      label: "7 días",
      startDate: shiftDateInputValue(todayValue, -6),
      endDate: todayValue,
    },
    { id: "thisMonth", label: "Este mes", startDate: monthStart, endDate: todayValue },
    {
      id: "last30",
      label: "Últimos 30 días",
      startDate: shiftDateInputValue(todayValue, -29),
      endDate: todayValue,
    },
  ];
}

export function activeReportPeriodPresetId(
  presets: ReportPeriodPreset[],
  startDate: string,
  endDate: string,
): ReportPeriodPresetId | null {
  const match = presets.find(
    (preset) => preset.startDate === startDate && preset.endDate === endDate,
  );
  return match?.id ?? null;
}

/** Keeps a custom range complete and ordered; `null` when neither date is set. */
export function normalizeReportPeriod(
  startDate: string,
  endDate: string,
): { startDate: string; endDate: string } | null {
  const start = startDate || endDate;
  const end = endDate || startDate;
  if (!start || !end) return null;
  return start <= end
    ? { startDate: start, endDate: end }
    : { startDate: end, endDate: start };
}

export interface CategoryShare {
  label: string;
  total: number;
  quantity: number;
  /** Exact fraction of the period total, for stacked-bar widths. */
  share: number;
  /** Rounded percentage, for the legend. */
  percentage: number;
}

/**
 * Turns the category ranking into one 100%-stacked mix: the five biggest
 * categories plus everything else grouped as "Otras". A category that sold
 * nothing is not a slice.
 */
export function categoryShares(
  categories: Array<{ category: string; total: number; quantity: number }>,
  limit = 5,
): CategoryShare[] {
  const sorted = categories
    .filter((category) => category.total > 0)
    .sort((a, b) => b.total - a.total);
  const visible = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const remainder = rest.reduce(
    (sum, category) => ({
      total: sum.total + category.total,
      quantity: sum.quantity + category.quantity,
    }),
    { total: 0, quantity: 0 },
  );
  const entries =
    remainder.total > 0
      ? [...visible, { category: "Otras", ...remainder }]
      : visible;
  const total = entries.reduce((sum, entry) => sum + entry.total, 0);

  return entries.map((entry) => {
    const share = total > 0 ? entry.total / total : 0;
    return {
      label: entry.category,
      total: entry.total,
      quantity: entry.quantity,
      share,
      percentage: Math.round(share * 100),
    };
  });
}

/** A payment method that collected nothing is not worth a row. */
export function visiblePaymentMethods<T extends { total: number | string }>(
  methods: T[],
): T[] {
  return methods.filter((method) => safeDecimalNumber(method.total) !== 0);
}

export const CUSTOMER_RANKING_LIMIT = 5;

type CustomerRankingRow = CustomerStatistics["topCustomers"][number];

/**
 * Five rows is a ranking; one row is a sentence. The caller renders the
 * `single` mode as a line of text instead of a table card.
 */
export type CustomerRanking =
  | { mode: "empty"; rows: [] }
  | { mode: "single"; rows: [CustomerRankingRow] }
  | { mode: "table"; rows: CustomerRankingRow[] };

export function customerRanking(
  rows: CustomerRankingRow[],
  limit = CUSTOMER_RANKING_LIMIT,
): CustomerRanking {
  if (rows.length === 0) return { mode: "empty", rows: [] };
  if (rows.length === 1) return { mode: "single", rows: [rows[0]] };
  return { mode: "table", rows: rows.slice(0, limit) };
}

/** The server already ships per-product margins; ranking them is presentation. */
export function topProductsByGrossProfit(
  products: FinancialProductMargin[],
  limit = 5,
): FinancialProductMargin[] {
  return [...products]
    .sort(
      (a, b) => safeDecimalNumber(b.grossProfit) - safeDecimalNumber(a.grossProfit),
    )
    .slice(0, limit);
}
