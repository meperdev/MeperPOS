import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { PaymentConfirmationModal } from "./PaymentConfirmationModal";
import type { CartItem } from "@/types";

// PaymentMethod is defined locally (unexported) inside the component; derive it
// from the component's props so this test's type always matches its contract.
type PaymentMethod = ComponentProps<typeof PaymentConfirmationModal>["paymentMethods"][number];

/**
 * S4 task 4.1 characterization baseline: locks the CURRENT currency output of
 * the payment confirmation modal before routing the quick-cash buttons through
 * formatCurrency (task 4.2). The summary rows already use formatCurrency, so
 * their assertions must stay IDENTICAL across 4.1 and 4.2 — any change there
 * is drift beyond the user-accepted quick-amount delta (amendment #404-3).
 * The quick-cash buttons used to render a raw, browser-locale dependent
 * amount; this file documented the before-value ("$10.000" under es-CO).
 */

const mockCartItem: CartItem = {
  productId: "prod-1",
  product: {
    id: "prod-1",
    name: "Aceite motor 1L",
    sku: "ACE-001",
    barcode: null,
    description: null,
    costPrice: 9000,
    salePrice: 15000,
    taxRate: 19,
    stock: 10,
    minStock: 2,
    imageUrl: null,
    categoryId: "cat-1",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    organizationId: "org-1",
    version: 1,
  },
  quantity: 2,
  unitPrice: 15000,
  originalUnitPrice: 15000,
  availableStock: 10,
  discountAmount: 0,
};

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  cart: [mockCartItem],
  subtotal: 45000,
  taxAmount: 8550,
  total: 53550,
  selectedMethod: "CASH" as const,
  paymentMethods: [{ type: "CASH", amount: 5000 }] as PaymentMethod[],
  onPaymentMethodChange: vi.fn(),
};

// formatCurrency inserts a no-break space (U+00A0) after the "$" symbol.
// Testing Library collapses node whitespace before matching string matchers,
// so getByText queries use regular spaces. getByRole name matchers preserve
// the exact accessible name and need the literal NBSP instead.
const fmtText = (amount: string) => `$ ${amount}`;
const NBSP = "\u00A0";

describe("PaymentConfirmationModal currency output", () => {
  it("renders summary amounts through formatCurrency (pre/post invariant)", () => {
    render(<PaymentConfirmationModal {...baseProps} />);

    // These strings are identical before and after task 4.2 — formatCurrency
    // output with the es-CO no-break space after the symbol.
    expect(screen.getByText(fmtText("45.000"))).toBeInTheDocument(); // Subtotal
    expect(screen.getByText(fmtText("8.550"))).toBeInTheDocument(); // Impuestos
    expect(screen.getByText(`-${fmtText("0")}`)).toBeInTheDocument(); // Descuentos
    expect(screen.getByText(fmtText("53.550"))).toBeInTheDocument(); // Total
    expect(screen.getByText(fmtText("5.000"))).toBeInTheDocument(); // Pagado
    expect(screen.getByText(fmtText("48.550"))).toBeInTheDocument(); // Faltante
    expect(
      screen.getByRole("button", {
        name: `Completar con Efectivo ($${NBSP}48.550)`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(fmtText("30.000"))).toBeInTheDocument(); // Cart line total (2 x 15.000)
    // change = 0 with these props → row absent
    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
  });

  it("renders quick cash amounts through formatCurrency (deterministic es-CO)", () => {
    render(<PaymentConfirmationModal {...baseProps} />);

    // After-value (formatCurrency, deterministic es-CO, amendment #404-3):
    // "$ 10.000" with a no-break space between symbol and amount.
    expect(
      screen.getByRole("button", { name: `$${NBSP}10.000` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `$${NBSP}20.000` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `$${NBSP}50.000` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `$${NBSP}100.000` }),
    ).toBeInTheDocument();
  });
});

/**
 * The persisted `sale.change` is the contract: `SalesService.create` stores
 * `cashPaid > total ? cashPaid - total : null`. Change is CASH-ONLY and is measured
 * against the FULL total — a non-cash tender is never netted out of it. The preview
 * therefore has to use the same rule, or the cashier reads a number the sale does not
 * carry.
 */
describe("PaymentConfirmationModal change preview — server parity", () => {
  /** Mirrors the server formula exactly, so the two can be compared case by case. */
  const serverChange = (total: number, methods: PaymentMethod[]) => {
    const cashPaid = methods
      .filter((method) => method.type === "CASH")
      .reduce((sum, method) => sum + method.amount, 0);
    return cashPaid > total ? cashPaid - total : null;
  };

  /**
   * The change row's own amount. Scoped to the row because the quick-cash buttons render
   * the same formatted amounts (20.000 / 50.000), so a bare text query is ambiguous.
   */
  const renderedChange = () => {
    const label = screen.queryByText("Cambio");
    return label?.parentElement?.textContent ?? null;
  };
  /** Same string, but with the literal NBSP that raw textContent preserves. */
  const fmtRaw = (amount: string) => `$${NBSP}${amount}`;

  it("shows NO change when cash under-tenders the total and a card covers the rest", () => {
    // total 100.000, cash 60.000, card 60.000 → fully covered, but the cash side is short.
    const paymentMethods = [
      { type: "CASH", amount: 60000 },
      { type: "CARD", amount: 60000 },
    ] as PaymentMethod[];

    // The old formula netted the card off the total and printed a phantom $20.000.
    expect(serverChange(100000, paymentMethods)).toBeNull();

    render(
      <PaymentConfirmationModal
        {...baseProps}
        total={100000}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
    // The sale is still payable: total covered, just not in cash.
    expect(
      screen.getByRole("button", { name: /Confirmar pago/i }),
    ).toBeEnabled();
  });

  it("shows exactly cash - total when cash over-tenders alongside a card", () => {
    const paymentMethods = [
      { type: "CASH", amount: 120000 },
      { type: "CARD", amount: 60000 },
    ] as PaymentMethod[];

    // Change is not netted against the card: it is the full 20.000 of surplus cash.
    expect(serverChange(100000, paymentMethods)).toBe(20000);

    render(
      <PaymentConfirmationModal
        {...baseProps}
        total={100000}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.getByText("Cambio")).toBeInTheDocument();
    expect(renderedChange()).toContain(fmtRaw("20.000"));
  });

  it("shows no change for a pure non-cash payment", () => {
    const paymentMethods = [{ type: "CARD", amount: 100000 }] as PaymentMethod[];

    expect(serverChange(100000, paymentMethods)).toBeNull();

    render(
      <PaymentConfirmationModal
        {...baseProps}
        total={100000}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
  });

  it("shows no change when the cash tender equals the total", () => {
    const paymentMethods = [{ type: "CASH", amount: 100000 }] as PaymentMethod[];

    // Equal is not greater: the server persists null, and so does the preview.
    expect(serverChange(100000, paymentMethods)).toBeNull();

    render(
      <PaymentConfirmationModal
        {...baseProps}
        total={100000}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
  });

  it("shows the surplus cash when cash alone over-tenders", () => {
    const paymentMethods = [{ type: "CASH", amount: 150000 }] as PaymentMethod[];

    expect(serverChange(100000, paymentMethods)).toBe(50000);

    render(
      <PaymentConfirmationModal
        {...baseProps}
        total={100000}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.getByText("Cambio")).toBeInTheDocument();
    expect(renderedChange()).toContain(fmtRaw("50.000"));
  });

  it("still withholds the change row while the sale is under-tendered overall", () => {
    const paymentMethods = [{ type: "CASH", amount: 40000 }] as PaymentMethod[];

    render(
      <PaymentConfirmationModal
        {...baseProps}
        total={100000}
        paymentMethods={paymentMethods}
      />,
    );

    expect(serverChange(100000, paymentMethods)).toBeNull();
    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
    expect(screen.getByText("Faltante")).toBeInTheDocument();
    expect(screen.getByText(fmtText("60.000"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirmar pago/i }),
    ).toBeDisabled();
  });
});
