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

    // Selected option uses neutral elevated card surface + subtle terracotta icon, never neon green.
    expect(cashBtn.className).toContain("bg-card");
    expect(cashBtn.className).not.toMatch(/success|emerald|green/);
    expect(cashBtn.firstElementChild?.className).toContain("text-primary-text");
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
