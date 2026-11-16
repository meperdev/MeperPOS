import type {
  WhatsAppDelivery,
  WhatsAppDeliveryFailure,
  WhatsAppDeliveryKind,
  WhatsAppDeliveryStatus,
} from "@/types";

/**
 * A run of consecutive, identical attempts, as the history shows them.
 *
 * The list arrives newest first and a run only holds attempts that are next to
 * each other: a manual report in the middle of eleven failed days is its own row,
 * because that is what happened.
 */
export interface DeliveryGroup {
  /**
   * Stable across refetches: the run is identified by its oldest day, so a day
   * added tomorrow does not close the disclosure the operator opened today.
   */
  key: string;
  kind: WhatsAppDeliveryKind;
  status: WhatsAppDeliveryStatus;
  failureReason: WhatsAppDeliveryFailure | null;
  /** The attempts of the run, oldest first. */
  members: WhatsAppDelivery[];
  /** The calendar days covered, oldest first (`YYYY-MM-DD`). */
  days: string[];
  /** Whether every day follows the previous one. */
  consecutiveDays: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every date in this module is a report day: an instant at UTC midnight that
 * stands for a calendar day, not for a moment. Formatting it in the runner's or
 * the reader's zone would move it a day, so the two formatters pin `UTC`.
 */
const UTC = { timeZone: "UTC" } as const;

const dayLong = new Intl.DateTimeFormat("es-CO", {
  ...UTC,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dayShort = new Intl.DateTimeFormat("es-CO", {
  ...UTC,
  day: "numeric",
  month: "short",
});

/** `10 nov`: the day and the month, with no connector between them. */
function shortDay(day: string): string {
  const parts = dayShort.formatToParts(atUtcMidnight(day));
  const value = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return [value, month].filter(Boolean).join(" ");
}

/** The calendar day of a reportDate, whether it arrives as a date or an instant. */
const dayOf = (reportDate: string): string => reportDate.slice(0, 10);

const atUtcMidnight = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** One day, written the way the expanded rows write it. */
export function formatDeliveryDay(day: string): string {
  return dayLong.format(atUtcMidnight(dayOf(day)));
}

const sameRun = (left: WhatsAppDelivery, right: WhatsAppDelivery): boolean =>
  left.kind === right.kind &&
  left.status === right.status &&
  (left.failureReason ?? null) === (right.failureReason ?? null);

/**
 * Collapse consecutive identical attempts into one group. Single attempts come
 * back as a group of one, so the table renders every row from the same shape.
 */
export function groupDeliveries(
  deliveries: readonly WhatsAppDelivery[],
): DeliveryGroup[] {
  const runs: WhatsAppDelivery[][] = [];
  for (const delivery of deliveries) {
    const current = runs[runs.length - 1];
    if (current && sameRun(current[0], delivery)) {
      current.push(delivery);
      continue;
    }
    runs.push([delivery]);
  }

  return runs.map((newestFirst) => {
    const members = [...newestFirst].reverse();
    const days = members.map((member) => dayOf(member.reportDate));
    const consecutiveDays = days.every(
      (day, index) =>
        index === 0 ||
        atUtcMidnight(day).getTime() - atUtcMidnight(days[index - 1]).getTime() ===
          DAY_MS,
    );

    return {
      key: `${members[0].kind}:${members[0].status}:${members[0].failureReason ?? "none"}:${days[0]}`,
      kind: members[0].kind,
      status: members[0].status,
      failureReason: members[0].failureReason,
      members,
      days,
      consecutiveDays,
    };
  });
}

const HEADLINES: Record<WhatsAppDeliveryStatus, string> = {
  FAILED: "Falló",
  SENT: "Enviado",
  PENDING: "En curso",
};

/**
 * What the run did, in one line: "Falló 11 días seguidos" for a daily streak,
 * "Enviado 2 veces" when the days are not consecutive (two manual reports on the
 * same day, for instance), and the bare verb for a single attempt, which the
 * table already dates.
 */
export function groupHeadline(group: DeliveryGroup): string {
  const count = group.members.length;
  if (count === 1) return HEADLINES[group.status];
  if (group.consecutiveDays) {
    return `${HEADLINES[group.status]} ${count} días seguidos`;
  }
  return `${HEADLINES[group.status]} ${count} veces`;
}

/** The days the run covers, as the compact range the row shows. */
export function groupRange(group: DeliveryGroup): string {
  const first = shortDay(group.days[0]);
  const lastDay = group.days[group.days.length - 1];
  if (lastDay === group.days[0]) return first;
  return `${first} – ${shortDay(lastDay)}`;
}
