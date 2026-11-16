import { describe, expect, it } from "vitest";
import type {
  StockAlertEventKind,
  StockAlertHistoryItem,
} from "@/hooks/useAlertNotifications";
import {
  ALERT_EVENT_KIND_META,
  alertProductHref,
  describeFailureReason,
  groupAlertEventsByDay,
} from "./alert-history";

function event(
  overrides: Partial<StockAlertHistoryItem> & { id: string; createdAt: string },
): StockAlertHistoryItem {
  return {
    product: { id: "p1", name: "Café molido 500 g", sku: "BEB-003" },
    episode: 1,
    kind: "NOTIFIED",
    failureReason: null,
    ...overrides,
  };
}

describe("groupAlertEventsByDay", () => {
  // 10:00 in Bogotá on 16 November 2026.
  const now = new Date("2026-11-16T15:00:00.000Z");
  const today = event({ id: "today", createdAt: "2026-11-16T14:00:00.000Z" });
  const yesterdayLate = event({ id: "y1", createdAt: "2026-11-16T03:00:00.000Z" });
  const yesterdayEarlier = event({
    id: "y2",
    createdAt: "2026-11-16T02:00:00.000Z",
  });
  const older = event({ id: "older", createdAt: "2026-11-14T15:00:00.000Z" });

  it("labels today and yesterday in words and every older day in full", () => {
    const groups = groupAlertEventsByDay(
      [today, yesterdayLate, yesterdayEarlier, older],
      now,
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Hoy",
      "Ayer",
      "14 de noviembre de 2026",
    ]);
  });

  it("keeps the server's newest-first order inside and across the groups", () => {
    const groups = groupAlertEventsByDay(
      [today, yesterdayLate, yesterdayEarlier, older],
      now,
    );

    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["today"],
      ["y1", "y2"],
      ["older"],
    ]);
  });

  it("groups by the Bogotá calendar day, not the UTC one", () => {
    // 02:00Z on the 16th is still the evening of the 15th in Bogotá.
    const groups = groupAlertEventsByDay([yesterdayEarlier], now);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Ayer");
  });

  it("returns no groups for an empty page", () => {
    expect(groupAlertEventsByDay([], now)).toEqual([]);
  });
});

describe("describeFailureReason", () => {
  it.each([
    ["no_recipient", "Sin destinatario"],
    ["provider_rejected", "Rechazado por el proveedor"],
    ["send_failed", "Error de envío"],
  ])("writes %s as user-facing Spanish", (reason, label) => {
    expect(describeFailureReason(reason)).toBe(label);
  });

  it("falls back to the raw code for a reason it does not know", () => {
    expect(describeFailureReason("rate_limited")).toBe("rate_limited");
  });
});

describe("ALERT_EVENT_KIND_META", () => {
  const kinds: StockAlertEventKind[] = [
    "OPENED",
    "RESOLVED",
    "NOTIFIED",
    "FAILED",
    "SKIPPED",
  ];

  it("names every kind with a single state word", () => {
    expect(kinds.map((kind) => ALERT_EVENT_KIND_META[kind].label)).toEqual([
      "Abierto",
      "Resuelto",
      "Enviado",
      "Falló",
      "Omitido",
    ]);
  });

  it("gives a delivery dot to the three WhatsApp outcomes only", () => {
    expect(
      kinds.map((kind) => ALERT_EVENT_KIND_META[kind].tone ?? null),
    ).toEqual([null, null, "success", "danger", "warning"]);
  });
});

describe("alertProductHref", () => {
  it("opens the low-stock catalog while the episode is still low", () => {
    expect(alertProductHref("NOTIFIED")).toBe("/inventory?filter=lowStock");
    expect(alertProductHref("OPENED")).toBe("/inventory?filter=lowStock");
    expect(alertProductHref("FAILED")).toBe("/inventory?filter=lowStock");
    expect(alertProductHref("SKIPPED")).toBe("/inventory?filter=lowStock");
  });

  it("opens the catalog unfiltered once the product recovered", () => {
    expect(alertProductHref("RESOLVED")).toBe("/inventory");
  });
});
