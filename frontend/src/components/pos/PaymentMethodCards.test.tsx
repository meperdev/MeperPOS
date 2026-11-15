import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PaymentMethodCards } from "@/components/pos/PaymentMethodCards";

afterEach(() => {
  cleanup();
});

describe("PaymentMethodCards layout", () => {
  it("uses two columns with the odd last method spanning the row, at any viewport", () => {
    render(<PaymentMethodCards selectedMethod="CASH" onMethodChange={vi.fn()} />);

    const group = screen.getByRole("button", { name: "Efectivo" }).parentElement;
    expect(group).not.toBeNull();
    expect(group!.className).toContain("grid-cols-2");
    expect(group!.className).not.toMatch(/(^|\s)(md|sm):grid-cols/);
    expect(screen.getByRole("button", { name: /Transferencia/ }).className).toContain("col-span-2");
    expect(screen.getByRole("button", { name: "Efectivo" }).className).not.toContain("col-span-2");
  });

  it("keeps labels from truncating so they show fully in an 18rem cart", () => {
    render(<PaymentMethodCards selectedMethod="CASH" onMethodChange={vi.fn()} />);

    const label = screen.getByText("Transferencia");
    const card = screen.getByRole("button", { name: /Transferencia/ });
    expect(label.className).not.toContain("truncate");
    expect(label.className).toContain("whitespace-nowrap");
    expect(card.className).toContain("flex-col");
  });
});
