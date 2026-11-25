import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PaymentMethodsCard } from "./PaymentMethodsCard";
import { formatCurrency } from "@/lib/utils";
import type { SaleByPaymentMethod } from "@/types";

const useSalesByPaymentMethodMock = vi.fn();

vi.mock("@/hooks/useReports", () => ({
  useSalesByPaymentMethod: (startDate: string, endDate: string) =>
    useSalesByPaymentMethodMock(startDate, endDate),
}));

const rows: SaleByPaymentMethod[] = [
  { paymentMethod: "CASH", total: 50000, subtotal: 0, count: 2 },
  { paymentMethod: "CARD", total: 30000, subtotal: 0, count: 1 },
  { paymentMethod: "TRANSFER", total: 20000, subtotal: 0, count: 1 },
];

describe("PaymentMethodsCard (Recharts donut)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSalesByPaymentMethodMock.mockReturnValue({ data: { data: rows } });
  });

  afterEach(() => {
    cleanup();
  });

  it("fetches its own window from the range props", () => {
    render(<PaymentMethodsCard startDate="2026-08-16" endDate="2026-08-22" />);

    expect(useSalesByPaymentMethodMock).toHaveBeenCalledWith(
      "2026-08-16",
      "2026-08-22",
    );
  });

  it("renders exactly the three real methods with their share percentages", () => {
    render(<PaymentMethodsCard startDate="2026-08-16" endDate="2026-08-22" />);

    const methodRows = screen.getAllByTestId("payment-method-row");
    expect(methodRows).toHaveLength(3);

    expect(screen.getByText("Efectivo")).toBeTruthy();
    expect(screen.getByText("Tarjeta")).toBeTruthy();
    expect(screen.getByText("Transferencia")).toBeTruthy();

    const percentages = screen
      .getAllByTestId("payment-method-percentage")
      .map((node) => node.textContent);
    expect(percentages).toEqual(["50%", "30%", "20%"]);
  });

  it("takes its slice inks from the series tokens, never from the status greens and blues", () => {
    render(<PaymentMethodsCard startDate="2026-08-16" endDate="2026-08-22" />);

    const swatches = screen
      .getAllByTestId("payment-method-row")
      .map((row) => row.querySelector("span[style]")?.getAttribute("style") ?? "");

    // Efectivo keeps the brand terracotta; Tarjeta takes the sand ink and
    // Transferencia the muted sage, both defined as tokens.
    expect(swatches[0]).toContain("var(--primary)");
    expect(swatches[1]).toContain("var(--chart-ink)");
    expect(swatches[2]).toContain("var(--chart-ink-muted)");

    const inks = swatches.join(" ");
    expect(inks).not.toContain("var(--success)");
    expect(inks).not.toContain("var(--info)");
  });

  it("lets its own width, not the viewport, pick the legend layout", () => {
    render(<PaymentMethodsCard startDate="2026-08-16" endDate="2026-08-22" />);

    const card = screen.getByTestId("payment-methods-card");
    expect(card.className).toContain("@container");

    // The donut stays beside the legend at every width.
    const compact = screen.getByTestId("payment-methods-chart");
    expect(compact.parentElement?.className).toContain("flex-row");

    // Two donut sizes drive off container queries; the compact one owns the testids.
    expect(compact.className).toContain("@[26rem]:hidden");
    const wide = screen.getByTestId("payment-methods-chart-wide");
    expect(wide.className).toContain("hidden");
    expect(wide.className).toContain("@[26rem]:block");
    expect(screen.getAllByTestId("payment-methods-total")).toHaveLength(1);

    for (const name of ["Efectivo", "Tarjeta", "Transferencia"]) {
      const label = screen.getByText(name);
      expect(label.textContent?.trim()).toBe(name);
      // Line one belongs to the name: it takes every pixel left of the dot.
      expect(label.className).toContain("min-w-0");
      expect(label.className).toContain("truncate");
      expect(label.className).toContain("text-sm");
      expect(label.className).toContain("col-start-2");
      expect(label.className).not.toContain("min-w-[5.5rem]");
    }

    const rows = screen.getAllByTestId("payment-method-row");
    const legend = rows[0].parentElement as HTMLElement;
    expect(legend.className).toContain("space-y-2.5");

    for (const methodRow of rows) {
      expect(methodRow.className).toContain(
        "grid-cols-[0.625rem_minmax(0,1fr)]",
      );
      expect(methodRow.className).toContain(
        "@[26rem]:grid-cols-[0.625rem_minmax(0,1fr)_auto_auto]",
      );
      // Exactly one share is visible per composition: the boxed chip in wide,
      // the plain inline share in compact.
      const boxed = within(methodRow).getByTestId("payment-method-percentage");
      expect(boxed.className).toContain("w-11");
      expect(boxed.className).toContain("hidden");
      expect(boxed.className).toContain("@[26rem]:inline-flex");
      const inline = within(methodRow).getByTestId(
        "payment-method-percentage-compact",
      );
      expect(inline.className).toContain("@[26rem]:hidden");
      expect(inline.className).toContain("ml-1.5");
      expect(inline.className).toContain("text-xs");
      expect(inline.className).toContain("text-muted-foreground");
      expect(inline.className).toContain("tabular-nums");
      expect(inline.className).not.toContain("border");
      expect(inline.className).not.toContain("inline-flex");
    }

    const amount = rows[0].lastElementChild as HTMLElement;
    // The share rides after the amount as plain text, so nothing can ellipsize.
    expect(amount.textContent).toBe(`${formatCurrency(50000)} 50%`);
    expect(amount.className).toContain("col-start-2");
    expect(amount.className).toContain("row-start-2");
    expect(amount.className).toContain("text-[13px]");
    expect(amount.className).toContain("tabular-nums");
    expect(amount.className).toContain("whitespace-nowrap");
    expect(amount.className).not.toContain("truncate");
    expect(amount.className).toContain("@[26rem]:col-start-4");
    expect(amount.className).toContain("@[26rem]:row-start-1");
    expect(amount.className).toContain("@[26rem]:text-sm");
    expect(amount.className).toContain("@[26rem]:text-right");
  });

  it("shrinks the donut to 96px in the compact composition", () => {
    render(<PaymentMethodsCard startDate="2026-08-16" endDate="2026-08-22" />);

    expect(
      screen.getByTestId("payment-methods-chart").querySelector("svg")?.getAttribute("width"),
    ).toBe("96");
    expect(
      screen.getByTestId("payment-methods-chart-wide").querySelector("svg")?.getAttribute("width"),
    ).toBe("136");
    // The compact total drops to the 12px floor so it clears the 64px hole.
    expect(screen.getByTestId("payment-methods-total").className).toContain("text-xs");
  });

  it("shows the window total in the centre of the donut", () => {
    render(<PaymentMethodsCard startDate="2026-08-16" endDate="2026-08-22" />);

    expect(screen.getByTestId("payment-methods-chart")).toBeTruthy();
    expect(screen.getByTestId("payment-methods-total").textContent).toBe(
      formatCurrency(100000),
    );
  });

  it("never fabricates an 'Otros' bucket", () => {
    render(<PaymentMethodsCard startDate="2026-08-16" endDate="2026-08-22" />);

    expect(screen.queryByText(/Otros/)).toBeNull();
    expect(screen.getAllByTestId("payment-method-row")).toHaveLength(3);
  });
});
