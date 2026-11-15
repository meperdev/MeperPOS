import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SaleCardRow } from "@/components/sales/SaleCardRow";
import { PaymentStateBadge } from "@/components/sales/PaymentState";

describe("SaleCardRow", () => {
  it("lays the label and value on one baseline and never abbreviates the payment label", () => {
    render(
      <SaleCardRow label="Método de pago">
        <PaymentStateBadge payments={[{ method: "CASH" }]} />
      </SaleCardRow>,
    );

    const label = screen.getByText("Método de pago");
    const row = label.parentElement!;
    expect(row).toHaveClass("flex", "items-baseline", "justify-between", "gap-3");
    expect(label).toHaveClass("shrink-0", "text-muted-foreground");
    const value = row.lastElementChild as HTMLElement;
    expect(value).toHaveClass("min-w-0", "text-right");
    expect(value).not.toHaveClass("truncate");
    expect(value).toHaveTextContent("Efectivo");
    expect(screen.queryByText("Efec")).toBeNull();
  });

  it("truncates the value only when asked to", () => {
    const { unmount } = render(<SaleCardRow label="Cliente" truncate>Cliente muy largo</SaleCardRow>);
    expect(screen.getByText("Cliente muy largo")).toHaveClass("min-w-0", "text-right", "truncate");
    unmount();

    render(<SaleCardRow label="Fecha">15/11/2026, 10:30 a. m.</SaleCardRow>);
    expect(screen.getByText("15/11/2026, 10:30 a. m.")).toHaveClass("min-w-0", "text-right");
    expect(screen.getByText("15/11/2026, 10:30 a. m.")).not.toHaveClass("truncate");
  });
});
