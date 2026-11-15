import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PaymentMethodCards } from "@/components/pos/PaymentMethodCards";

afterEach(() => {
  cleanup();
});

describe("PaymentMethodCards layout", () => {
  it("wraps by container width instead of viewport breakpoints", () => {
    render(<PaymentMethodCards selectedMethod="CASH" onMethodChange={vi.fn()} />);

    const group = screen.getByRole("button", { name: "Efectivo" }).parentElement;
    expect(group).not.toBeNull();
    expect(group!.className).toContain("grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))]");
    expect(group!.className).not.toMatch(/(^|\s)(md|sm):grid-cols/);
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
