import { shiftDateInputValue } from "@/lib/utils";
import type { DailySale, SaleByCategoryDaily, Task, TaskStatus } from "@/types";

export interface TodaySaleRecord {
  total: number;
  count: number;
}

export interface TodayMetrics {
  sales: number;
  transactions: number;
  ticket: number;
}

/**
 * Derives the day KPIs from a single DailySale record.
 * Guards against a division by zero: when `count` is 0 the ticket is 0.
 */
export function computeTodayMetrics(rec?: TodaySaleRecord): TodayMetrics {
  const total = rec?.total ?? 0;
  const count = rec?.count ?? 0;

  return {
    sales: total,
    transactions: count,
    ticket: count > 0 ? total / count : 0,
  };
}

// ─── Dashboard KPI window helpers ─────────────────────────────────────────────

/**
 * Inclusive list of `YYYY-MM-DD` days ending at `endDate`, `length` entries
 * long, ordered oldest → newest. This is the dashboard KPI window: 8 days give
 * the sparkline's last 7 days plus yesterday's comparison baseline.
 */
export function buildDateWindow(endDate: string, length: number): string[] {
  if (length <= 0) {
    return [];
  }

  return Array.from({ length }, (_, index) =>
    shiftDateInputValue(endDate, index - (length - 1)),
  );
}

// ─── Dashboard range selector helpers ─────────────────────────────────────────

export type DashboardRangeKey = "7d" | "15d" | "1m";

export interface DashboardRangeDescriptor {
  key: DashboardRangeKey;
  label: string;
  days: number;
}

/**
 * The three dashboard range options. `1m` is a rolling 30-day window, kept
 * consistent with the rolling 7/15-day options rather than a calendar month.
 */
export const DASHBOARD_RANGES: readonly DashboardRangeDescriptor[] = [
  { key: "7d", label: "7 días", days: 7 },
  { key: "15d", label: "15 días", days: 15 },
  { key: "1m", label: "1 mes", days: 30 },
];

/** Default range: the trailing 7 days. */
export const DEFAULT_DASHBOARD_RANGE: DashboardRangeKey = "7d";

/**
 * Resolves a range descriptor by key, falling back to the default range when
 * the key is unknown so the dashboard never renders an empty window.
 */
export function getDashboardRange(
  key: DashboardRangeKey,
): DashboardRangeDescriptor {
  return DASHBOARD_RANGES.find((range) => range.key === key) ?? DASHBOARD_RANGES[0];
}

/**
 * Turns a range key plus today's Bogotá `YYYY-MM-DD` into an inclusive
 * `{ startDate, endDate }` window ending today. Reuses `buildDateWindow` so the
 * date math stays in one place; `1m` resolves to a rolling 30-day window.
 */
export function resolveDashboardRange(
  key: DashboardRangeKey,
  today: string,
): { startDate: string; endDate: string } {
  const { days } = getDashboardRange(key);
  const window = buildDateWindow(today, days);

  return {
    startDate: window[0] ?? today,
    endDate: window[window.length - 1] ?? today,
  };
}

/**
 * Inclusive day count between two `YYYY-MM-DD` values (`end - start + 1`).
 * Returns 1 for unparseable input so callers always get a usable window.
 */
export function countDaysInclusive(startDate: string, endDate: string): number {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);

  if (!startYear || !startMonth || !startDay || !endYear || !endMonth || !endDay) {
    return 1;
  }

  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  const diff = Math.round((end - start) / 86_400_000) + 1;

  return diff > 0 ? diff : 1;
}

/** Money ticks without the full weight of a COP amount. */
export function formatCategoryAmountTick(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1_000_000_000) return `$${Math.round(value / 1_000_000_000)}MM`;
  if (value >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}


/**
 * Compact `d/m` axis tick for a `YYYY-MM-DD` day. Range-driven: it prints the
 * actual date instead of a month-bound `day % 5 === 0` rule.
 */
export function formatCategoryAxisTick(date: string): string {
  const [, month, day] = date.split("-").map(Number);

  if (!month || !day) {
    return date;
  }

  return `${day}/${month}`;
}

/**
 * Readable tooltip header for a `YYYY-MM-DD` day, e.g. "21 de ago" (Bogotá).
 */
export function formatCategoryTooltipDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);

  if (!year || !month || !day) {
    return date;
  }

  const safeDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    timeZone: "America/Bogota",
  }).format(safeDate);
}

/**
 * Maps `days` (oldest → newest) to a metric extracted from each day's
 * `DailySale` record, defaulting to 0 for days with no data. The returned array
 * is aligned 1:1 with `days`, ready to feed a sparkline.
 */
export function buildDailyMetricSeries(
  data: DailySale[] | undefined,
  days: string[],
  pick: (record: DailySale) => number,
): number[] {
  const byDate = new Map<string, DailySale>();
  for (const record of data ?? []) {
    byDate.set(record.date, record);
  }

  return days.map((day) => {
    const record = byDate.get(day);
    return record ? pick(record) : 0;
  });
}

/**
 * Relative delta of `current` against a `previous` baseline, as a percentage.
 * A missing or zero baseline returns `{ percentage: null }` so the caller
 * renders the "Sin base" label instead of inventing a comparison — the
 * dashboard must never fabricate an "Ayer" value it does not have.
 */
export function computeDelta(
  current: number,
  previous: number | null | undefined,
): { percentage: number | null } {
  if (!previous) {
    return { percentage: null };
  }

  return { percentage: ((current - previous) / previous) * 100 };
}

/**
 * Computes the pending amount of a partially-paid expense as
 * `total - sum(payments.amount)`. When payments is missing or empty the
 * pending amount falls back to the full `total`.
 */
export function computePendingAmount(expense: {
  total: number | string;
  payments?: Array<{ amount: number | string }>;
}): number {
  const total = toAmount(expense?.total);
  const payments = expense?.payments;

  if (!payments || payments.length === 0) {
    return total;
  }

  const paid = payments.reduce((sum, payment) => sum + toAmount(payment?.amount), 0);
  return total - paid;
}

/**
 * The API serializes Prisma `Decimal` money fields as strings ("5000.00").
 * Summing them raw concatenates digits, so every amount crosses this boundary
 * as a number. Non-finite input counts as zero.
 */
function toAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

const OPEN_TASK_STATUSES: TaskStatus[] = ["PENDING", "IN_PROGRESS"];

/**
 * Keeps only the client-side open tasks (PENDING / IN_PROGRESS) and caps
 * the result to `cap` entries (default 5).
 */
export function filterOpenTasks<T extends { status: TaskStatus }>(
  tasks: T[],
  cap = 5,
): T[] {
  return (tasks ?? []).filter((task) => OPEN_TASK_STATUSES.includes(task.status)).slice(0, cap);
}

/**
 * Returns a proportional chart bar height for a day total against the series
 * max. A zero (or immeasurable) total renders at the minimum visible height
 * (18%); non-zero totals are scaled to at least 28% and at most 100%.
 */
export function chartHeight(total: number, max: number): number {
  if (total <= 0 || max <= 0) {
    return 18;
  }

  const scaled = Math.round((total / max) * 100);
  return Math.max(28, Math.min(scaled, 100));
}

export type { Task };

// ─── Category stacked chart helpers ───────────────────────────────────────────

export const CATEGORY_CHART_PALETTE = [
  "#C25E36", // terracotta (brand primary)
  "#2563EB", // royal blue
  "#059669", // emerald green
  "#7C3AED", // deep violet
  "#D97706", // warm amber
  "#0891B2", // deep cyan
  "#DB2777", // rose pink
  "#EA580C", // rust orange
] as const;

export interface CategoryDailySegment {
  category: string;
  total: number;
  quantity: number;
}

export interface StackedDay {
  date: string;
  segments: CategoryDailySegment[];
  total: number;
}

/**
 * Assigns a stable chart color to each distinct category name. Colors are
 * ordered by the sorted category name so a given category keeps the same color
 * regardless of data ordering across renders.
 */
export function buildCategoryColorMap(
  categories: string[] | undefined,
): Map<string, string> {
  const unique = Array.from(new Set(categories ?? [])).filter(Boolean).sort((a, b) =>
    a.localeCompare(b),
  );
  const map = new Map<string, string>();
  unique.forEach((category, index) => {
    map.set(category, CATEGORY_CHART_PALETTE[index % CATEGORY_CHART_PALETTE.length]);
  });
  return map;
}

/**
 * Groups daily-by-category sale rows into one `StackedDay` per day in `days`.
 * Days without data render as a day with an empty segment list (total 0), so
 * the chart always shows one bar per day in the requested range.
 */
export function buildStackedDailySeries(
  data: SaleByCategoryDaily[] | undefined,
  days: string[] | undefined,
): StackedDay[] {
  const byDate = new Map<string, Map<string, CategoryDailySegment>>();

  for (const row of data ?? []) {
    const dayMap = byDate.get(row.date) ?? new Map<string, CategoryDailySegment>();
    const existing = dayMap.get(row.category) ?? {
      category: row.category,
      total: 0,
      quantity: 0,
    };
    existing.total += row.total ?? 0;
    existing.quantity += row.quantity ?? 0;
    dayMap.set(row.category, existing);
    byDate.set(row.date, dayMap);
  }

  return (days ?? []).map((date) => {
    const dayMap = byDate.get(date);
    const segments = dayMap
      ? Array.from(dayMap.values()).sort((a, b) => a.category.localeCompare(b.category))
      : [];
    return {
      date,
      segments,
      total: segments.reduce((sum, segment) => sum + segment.total, 0),
    };
  });
}

export type ExpenseDateLike = { date: string; total: number | string | null };

/**
 * Sums the `total` of the expenses whose Bogotá date matches `date`. Accepts
 * both plain `YYYY-MM-DD` values and ISO timestamps (matched on the first 10
 * characters) so it works against either serialization from the API.
 */
export function sumExpensesOnDate(
  expenses: ExpenseDateLike[] | undefined,
  date: string,
): number {
  return (expenses ?? []).reduce((sum, expense) => {
    if (!expense) return sum;
    const expenseDate = expense.date;
    const matches = expenseDate === date || expenseDate.slice(0, 10) === date;
    return matches ? sum + toAmount(expense.total) : sum;
  }, 0);
}
