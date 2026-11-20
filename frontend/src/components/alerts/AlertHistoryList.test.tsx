import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { StockAlertHistoryItem } from "@/hooks/useAlertNotifications";
import { AlertHistoryList } from "./AlertHistoryList";

const nowIso = new Date().toISOString();
const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString();

function event(
  overrides: Partial<StockAlertHistoryItem> & { id: string },
): StockAlertHistoryItem {
  return {
    product: { id: "p1", name: "Café molido 500 g", sku: "BEB-003" },
    episode: 2,
    kind: "NOTIFIED",
    failureReason: null,
    createdAt: nowIso,
    ...overrides,
  };
}

function renderList(items: StockAlertHistoryItem[]) {
  return render(<AlertHistoryList items={items} />);
}

function rowOf(name: string) {
  return screen.getByRole("link", { name: new RegExp(name) }).closest("li")!;
}

describe("AlertHistoryList", () => {
  it("groups the rows under a day heading and counts each group", () => {
    renderList([
      event({ id: "a" }),
      event({ id: "b", product: { id: "p2", name: "Arroz 1 kg", sku: "ABA-001" } }),
      event({ id: "c", createdAt: yesterdayIso }),
    ]);

    expect(screen.getByRole("heading", { name: "Hoy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ayer" })).toBeInTheDocument();

    const today = screen.getByRole("heading", { name: "Hoy" }).closest("section")!;
    expect(within(today).getAllByRole("listitem")).toHaveLength(2);
    expect(within(today).getByText("2")).toHaveClass("tabular-nums");
  });

  it("writes a state word for every kind in the payload", () => {
    renderList([
      event({ id: "1", kind: "OPENED" }),
      event({ id: "2", kind: "RESOLVED" }),
      event({ id: "3", kind: "NOTIFIED" }),
      event({ id: "4", kind: "FAILED", failureReason: "provider_rejected" }),
      event({ id: "5", kind: "SKIPPED", failureReason: "no_recipient" }),
    ]);

    for (const word of ["Abierto", "Resuelto", "Enviado", "Falló", "Omitido"]) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
  });

  it("shows a 6px delivery dot only for the WhatsApp outcomes", () => {
    renderList([
      event({ id: "1", kind: "OPENED" }),
      event({ id: "2", kind: "NOTIFIED" }),
      event({ id: "3", kind: "FAILED", failureReason: "send_failed" }),
      event({ id: "4", kind: "SKIPPED", failureReason: "no_recipient" }),
    ]);

    const outcomes = Array.from(
      document.querySelectorAll("[data-outcome]"),
    ).map((element) => element.getAttribute("data-outcome"));
    expect(outcomes).toEqual(["none", "success", "danger", "warning"]);

    const delivered = document.querySelector('[data-outcome="success"]')!;
    const dot = delivered.querySelector("span.h-1\\.5");
    expect(dot?.className).toContain("rounded-full");
    expect(dot).toHaveAttribute("aria-hidden", "true");
  });

  it("links the product to the low-stock catalog and keeps a resolved row unfiltered", () => {
    renderList([
      event({ id: "1" }),
      event({ id: "2", kind: "RESOLVED", product: { id: "p2", name: "Arroz 1 kg", sku: "ABA-001" } }),
    ]);

    expect(
      screen.getByRole("link", { name: "Café molido 500 g en inventario" }),
    ).toHaveAttribute("href", "/inventory?filter=lowStock");
    expect(
      screen.getByRole("link", { name: "Arroz 1 kg en inventario" }),
    ).toHaveAttribute("href", "/inventory");
  });

  it("keeps SKU and episode on the 4px grid with tabular figures", () => {
    renderList([event({ id: "1", episode: 7 })]);

    const row = rowOf("Café molido 500 g");
    const sku = within(row).getByText("BEB-003");
    expect(sku).toHaveClass("id-text");
    expect(sku).not.toHaveClass("font-mono");

    const episode = within(row).getByText("episodio 7");
    expect(episode).toHaveClass("tabular-nums");
  });

  it("names the failure reason in Spanish instead of the provider code", () => {
    renderList([event({ id: "1", kind: "FAILED", failureReason: "provider_rejected" })]);

    const row = rowOf("Café molido 500 g");
    expect(row).toHaveTextContent("Rechazado por el proveedor");
    expect(row).not.toHaveTextContent("provider_rejected");
  });
});
