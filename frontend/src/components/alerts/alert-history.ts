import {
  CircleSlash,
  PackageCheck,
  PackageMinus,
  Send,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { LOCALE, TIMEZONE } from "@/lib/constants";
import { getBogotaDateInputValue, shiftDateInputValue } from "@/lib/utils";
import type {
  StockAlertEventKind,
  StockAlertHistoryItem,
} from "@/hooks/useAlertNotifications";

/** The only semantic colour a history row uses: the delivery dot. */
export type AlertOutcomeTone = "success" | "warning" | "danger";

export interface AlertEventKindMeta {
  /** The 16px glyph that leads the row. */
  icon: LucideIcon;
  /** One sentence-case state word, read alone at the row's trailing edge. */
  label: string;
  /**
   * Delivery outcome dot. Absent for the two lifecycle transitions, which are
   * the product crossing its minimum and recovering — nothing was sent, so
   * nothing claims to have been.
   */
  tone?: AlertOutcomeTone;
}

/**
 * What each kind looks like in the list. The kind words are singular because
 * they name one row's state, while the filter above keeps the plural forms.
 */
export const ALERT_EVENT_KIND_META: Record<
  StockAlertEventKind,
  AlertEventKindMeta
> = {
  OPENED: { icon: PackageMinus, label: "Abierto" },
  RESOLVED: { icon: PackageCheck, label: "Resuelto" },
  NOTIFIED: { icon: Send, label: "Enviado", tone: "success" },
  FAILED: { icon: TriangleAlert, label: "Falló", tone: "danger" },
  SKIPPED: { icon: CircleSlash, label: "Omitido", tone: "warning" },
};

/**
 * The fixed provider codes, written for the person reading the history. An
 * unknown code falls through unchanged so a new one is never hidden.
 */
const FAILURE_REASON_LABELS: Record<string, string> = {
  no_recipient: "Sin destinatario",
  provider_rejected: "Rechazado por el proveedor",
  send_failed: "Error de envío",
};

export function describeFailureReason(reason: string): string {
  return FAILURE_REASON_LABELS[reason] ?? reason;
}

/**
 * Where a row's product opens. Every entry here is a stock episode, and the
 * catalog's only server-side filter is the low-stock set; a resolved episode is
 * back above its minimum, so that row opens the catalog unfiltered rather than
 * jumping to a filter that would hide exactly the product the reader followed.
 */
export function alertProductHref(kind: StockAlertEventKind): string {
  return kind === "RESOLVED" ? "/inventory" : "/inventory?filter=lowStock";
}

export interface AlertHistoryDayGroup {
  /** Bogotá calendar day, `YYYY-MM-DD`. */
  key: string;
  /** "Hoy", "Ayer", or the full date for anything older. */
  label: string;
  items: StockAlertHistoryItem[];
}

const dayLabelFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TIMEZONE,
});

function dayLabel(key: string, today: string, yesterday: string): string {
  if (key === today) return "Hoy";
  if (key === yesterday) return "Ayer";
  // Noon UTC keeps the formatter on the intended Bogotá day for every month.
  return dayLabelFormatter.format(new Date(`${key}T12:00:00.000Z`));
}

/**
 * Splits one page of history into day blocks. The server already returns the
 * newest row first, so insertion order is the reading order: today's block
 * first, then yesterday's, then each older day. Days are the Bogotá ones the
 * rest of the app uses, not the UTC days the timestamps arrive in.
 */
export function groupAlertEventsByDay(
  items: readonly StockAlertHistoryItem[],
  now: Date = new Date(),
): AlertHistoryDayGroup[] {
  const today = getBogotaDateInputValue(now);
  const yesterday = shiftDateInputValue(today, -1);

  const groups = new Map<string, AlertHistoryDayGroup>();
  for (const item of items) {
    const key = getBogotaDateInputValue(new Date(item.createdAt));
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, {
      key,
      label: dayLabel(key, today, yesterday),
      items: [item],
    });
  }

  return [...groups.values()];
}
