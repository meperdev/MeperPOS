import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentMethodCards } from "@/components/pos/PaymentMethodCards";

afterEach(() => {
  cleanup();
});

describe("PaymentMethodCards layout", () => {
  it("renders all three methods in one neutral segmented row without neon success styling", () => {
    render(<PaymentMethodCards selectedMethod="CASH" onMethodChange={vi.fn()} />);

    const group = screen.getByRole("group", { name: "Método de pago" });
    expect(group.className).toContain("grid-cols-3");
    expect(group.className).not.toContain("grid-cols-2");

    const cashBtn = screen.getByRole("button", { name: "Efectivo" });
    const cardBtn = screen.getByRole("button", { name: "Tarjeta" });
    const transferBtn = screen.getByRole("button", { name: "Transferencia" });

    expect(cashBtn).toHaveAttribute("aria-pressed", "true");
    expect(cardBtn).toHaveAttribute("aria-pressed", "false");
    expect(transferBtn).toHaveAttribute("aria-pressed", "false");

    // Recessed muted track + unmistakable terracotta active segment (never neon green).
    expect(group.className).toContain("bg-muted");
    expect(group.className).not.toContain("bg-muted/40");
    expect(group.className).toContain("border-border");

    expect(cashBtn.className).toContain("bg-primary-light");
    expect(cashBtn.className).toContain("border-primary/70");
    expect(cashBtn.className).toContain("text-primary-text");
    expect(cashBtn.className).toContain("ring-1");
    expect(cashBtn.className).toContain("ring-primary/25");
    expect(cashBtn.className).toContain("shadow-xs");
    expect(cashBtn.className).not.toMatch(/success|emerald|green/);
    expect(cashBtn.firstElementChild?.className).toContain("text-primary-text");

    expect(cardBtn.className).toContain("bg-transparent");
    expect(cardBtn.className).toContain("text-muted-foreground");
    expect(transferBtn.className).not.toContain("col-span-2");
  });

  it("keeps labels from truncating and notifies on method switch", async () => {
    const user = userEvent.setup();
    const onMethodChange = vi.fn();
    render(<PaymentMethodCards selectedMethod="CASH" onMethodChange={onMethodChange} />);

    const label = screen.getByText("Transferencia");
    expect(label.className).not.toContain("truncate");
    expect(label.className).toContain("whitespace-nowrap");
    expect(label.className).toContain("text-xs");

    await user.click(screen.getByRole("button", { name: "Tarjeta" }));
    expect(onMethodChange).toHaveBeenCalledWith("CARD");
  });
});
