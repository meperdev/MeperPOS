import { describe, expect, it } from "vitest";
import type { WhatsAppDelivery } from "@/types";
import {
  formatDeliveryDay,
  groupDeliveries,
  groupHeadline,
  groupRange,
} from "./delivery-groups";

/** One attempt, with the fields this screen reads. */
const delivery = (
  overrides: Partial<WhatsAppDelivery> & Pick<WhatsAppDelivery, "id">,
): WhatsAppDelivery => ({
  kind: "SCHEDULED",
  reportDate: "2026-11-10T00:00:00.000Z",
  status: "FAILED",
  failureReason: "no_recipient",
  sentAt: null,
  attempts: 1,
  ...overrides,
});

describe("delivery groups", () => {
  it("collapses a run of identical attempts into one group, days oldest first", () => {
    const groups = groupDeliveries([
      delivery({ id: "c", reportDate: "2026-11-12T00:00:00.000Z" }),
      delivery({ id: "b", reportDate: "2026-11-11T00:00:00.000Z" }),
      delivery({ id: "a", reportDate: "2026-11-10T00:00:00.000Z" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(groups[0].days).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(groups[0].consecutiveDays).toBe(true);
    expect(groupHeadline(groups[0])).toBe("Falló 3 días seguidos");
    expect(groupRange(groups[0])).toBe("10 nov – 12 nov");
  });

  it("only merges attempts that are next to each other", () => {
    const groups = groupDeliveries([
      delivery({ id: "d", reportDate: "2026-11-12T00:00:00.000Z" }),
      delivery({ id: "c", reportDate: "2026-11-11T00:00:00.000Z" }),
      // The manual report the administrator asked for, in the middle of the run.
      delivery({
        id: "b",
        kind: "ON_DEMAND",
        reportDate: "2026-11-11T00:00:00.000Z",
        status: "SENT",
        failureReason: null,
        sentAt: "2026-11-11T14:00:00.000Z",
      }),
      delivery({ id: "a", reportDate: "2026-11-10T00:00:00.000Z" }),
    ]);

    // `c` and `d` are the same kind of attempt on consecutive days, so they are
    // one run; the manual send is the row that breaks it.
    expect(groups.map((group) => group.members.map((row) => row.id))).toEqual([
      ["c", "d"],
      ["b"],
      ["a"],
    ]);
  });

  it("does not merge a different reason or status", () => {
    const groups = groupDeliveries([
      delivery({
        id: "c",
        status: "FAILED",
        failureReason: "provider_rejected",
      }),
      delivery({ id: "b", status: "FAILED", failureReason: "no_recipient" }),
      delivery({ id: "a", status: "SENT", failureReason: null }),
    ]);

    expect(groups).toHaveLength(3);
  });

  it("says how many times a run repeated when the days are not consecutive", () => {
    const groups = groupDeliveries([
      // Two manual sends on the same day: two rows, one day.
      delivery({
        id: "b",
        kind: "ON_DEMAND",
        reportDate: "2026-11-11T00:00:00.000Z",
        status: "SENT",
        failureReason: null,
        sentAt: "2026-11-11T15:00:00.000Z",
      }),
      delivery({
        id: "a",
        kind: "ON_DEMAND",
        reportDate: "2026-11-11T00:00:00.000Z",
        status: "SENT",
        failureReason: null,
        sentAt: "2026-11-11T14:00:00.000Z",
      }),
    ]);

    expect(groups[0].consecutiveDays).toBe(false);
    expect(groupHeadline(groups[0])).toBe("Enviado 2 veces");
    expect(groupRange(groups[0])).toBe("11 nov");
  });

  it("keeps the group key on the oldest day, so a new day does not collapse it", () => {
    // The server lists newest first.
    const before = groupDeliveries([
      delivery({ id: "b", reportDate: "2026-11-11T00:00:00.000Z" }),
      delivery({ id: "a", reportDate: "2026-11-10T00:00:00.000Z" }),
    ]);
    const after = groupDeliveries([
      delivery({ id: "c", reportDate: "2026-11-12T00:00:00.000Z" }),
      delivery({ id: "b", reportDate: "2026-11-11T00:00:00.000Z" }),
      delivery({ id: "a", reportDate: "2026-11-10T00:00:00.000Z" }),
    ]);

    expect(after[0].key).toBe(before[0].key);
  });

  it("describes one attempt in the same words as a row", () => {
    const [group] = groupDeliveries([
      delivery({ id: "a", reportDate: "2026-11-10T00:00:00.000Z" }),
    ]);

    expect(groupHeadline(group)).toBe("Falló");
    expect(groupRange(group)).toBe("10 nov");
  });

  it("names a day the same way everywhere, independent of the runner timezone", () => {
    expect(formatDeliveryDay("2026-10-29")).toBe("29 de octubre de 2026");
    expect(formatDeliveryDay("2026-11-10")).toBe("10 de noviembre de 2026");
  });

  it("has nothing to show for an empty history", () => {
    expect(groupDeliveries([])).toEqual([]);
  });
  it("never puts a sent attempt inside a failure group and keeps the newest group first", () => {
    const groups = groupDeliveries([
      delivery({
        id: "1",
        reportDate: "2026-03-06T00:00:00.000Z",
        failureReason: "send_failed",
      }),
      delivery({
        id: "2",
        reportDate: "2026-03-05T00:00:00.000Z",
        failureReason: "send_failed",
      }),
      delivery({
        id: "3",
        reportDate: "2026-03-04T00:00:00.000Z",
        kind: "ON_DEMAND",
        status: "SENT",
        failureReason: null,
      }),
      delivery({
        id: "4",
        reportDate: "2026-03-03T00:00:00.000Z",
        failureReason: "provider_rejected",
      }),
      delivery({
        id: "5",
        reportDate: "2026-03-02T00:00:00.000Z",
        failureReason: "provider_rejected",
      }),
      delivery({
        id: "6",
        reportDate: "2026-03-02T00:00:00.000Z",
        status: "SENT",
        failureReason: null,
      }),
    ]);

    for (const group of groups) {
      for (const member of group.members)
        expect(member.status).toBe(group.status);
    }
    expect(groups.flatMap((g) => g.members.map((m) => m.id)).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(groups.map((g) => g.members.length)).toEqual([2, 1, 2, 1]);
    expect(groupHeadline(groups[0])).toBe("Falló 2 días seguidos");
  });
});
