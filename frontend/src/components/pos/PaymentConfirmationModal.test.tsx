import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
        name: `Completar con efectivo ($${NBSP}48.550)`,
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

describe("PaymentConfirmationModal cent-exact checkout", () => {
  const props = { ...baseProps, subtotal: 854.25, taxAmount: 162.31, total: 1016.56 };

  it("shows and edits the card amount without discarding cents", () => {
    const onPaymentMethodChange = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <PaymentConfirmationModal
        {...props}
        selectedMethod="CARD"
        paymentMethods={[]}
        onPaymentMethodChange={onPaymentMethodChange}
        onConfirm={onConfirm}
      />,
    );

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("1.016,56");
    expect(screen.getByText("Total").parentElement).toHaveTextContent("1.016,56");
    fireEvent.change(input, { target: { value: "1.016,55" } });
    expect(onPaymentMethodChange).toHaveBeenLastCalledWith([{ type: "CARD", amount: 1016.55 }]);

    rerender(
      <PaymentConfirmationModal
        {...props}
        selectedMethod="CARD"
        paymentMethods={[{ type: "CARD", amount: 1016.55 }]}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Confirmar pago" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("completes the precise balance on top of cash already entered", () => {
    const onPaymentMethodChange = vi.fn();
    render(
      <PaymentConfirmationModal
        {...props}
        paymentMethods={[{ type: "CASH", amount: 0.07 }]}
        onPaymentMethodChange={onPaymentMethodChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: `Completar con efectivo ($${NBSP}1.016,49)`,
    }));
    expect(onPaymentMethodChange).toHaveBeenCalledExactlyOnceWith([{ type: "CASH", amount: 1016.56 }]);
  });

  it("confirms an exact split even when the floating-point sum is slightly short", () => {
    const onConfirm = vi.fn();
    render(
      <PaymentConfirmationModal
        {...props}
        onConfirm={onConfirm}
        paymentMethods={[
          { type: "CARD", amount: 666.81 },
          { type: "TRANSFER", amount: 259.34 },
          { type: "CASH", amount: 90.41 },
        ]}
      />,
    );

    expect(screen.queryByText("Faltante")).not.toBeInTheDocument();
    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

/**
 * The persisted `sale.change` is the contract (S3 / D1): `SalesService.create`
 * stores the overpaid amount, and refuses an overpayment that cannot come back as
 * cash or that carries a tender the rest of the payment already covers. The preview
 * therefore has to use the same rule, or the cashier reads a number the sale does not
 * carry — or confirms a payment the server will reject.
 */
describe("PaymentConfirmationModal change preview — server parity", () => {
  /** Mirrors the server formula exactly, so the two can be compared case by case. */
  const serverChange = (total: number, methods: PaymentMethod[]) => {
    const totalPaid = methods.reduce((sum, method) => sum + method.amount, 0);
    const overpay = totalPaid - total;
    return overpay > 0 ? overpay : null;
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

  it("hands cash back as change on a sale with nothing to collect", () => {
    // A fully discounted sale has total 0: no tender can be "needed", so the
    // server (SEC-015) accepts the cash and returns it whole.
    const paymentMethods = [{ type: "CASH", amount: 1000 }] as PaymentMethod[];

    render(
      <PaymentConfirmationModal
        {...baseProps}
        subtotal={0}
        taxAmount={0}
        total={0}
        paymentMethods={paymentMethods}
      />,
    );

    expect(renderedChange()).toContain(fmtRaw("1.000"));
    expect(screen.queryByText(/no dan cambio|Sobra un pago/)).not.toBeInTheDocument();
  });

  it("blocks change on a zero-total sale with both cash and a non-cash tender", () => {
    render(
      <PaymentConfirmationModal
        {...baseProps}
        subtotal={0}
        taxAmount={0}
        total={0}
        paymentMethods={[
          { type: "CASH", amount: 1000 },
          { type: "CARD", amount: 1000 },
        ]}
      />,
    );

    expect(screen.getByText(/Sobra un pago/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar pago/i })).toBeDisabled();
    expect(renderedChange()).toBeNull();
  });

  it("shows the overpaid amount when a card covers most of it and cash tops it up", () => {
    // total 100.000, cash 60.000, card 60.000 → each tender alone is short, so both
    // are needed and the 20.000 surplus legitimately comes back as change.
    const paymentMethods = [
      { type: "CASH", amount: 60000 },
      { type: "CARD", amount: 60000 },
    ] as PaymentMethod[];

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
    expect(
      screen.getByRole("button", { name: /Confirmar pago/i }),
    ).toBeEnabled();
  });

  it("shows the overpaid amount for the reported transfer-plus-cash split", () => {
    // The S3 case: 100.000 transfer + 20.000 cash on a 112.931 total must hand back
    // 7.069, not null (the old cash-only formula hid the surplus).
    const paymentMethods = [
      { type: "TRANSFER", amount: 100000 },
      { type: "CASH", amount: 20000 },
    ] as PaymentMethod[];

    expect(serverChange(112931, paymentMethods)).toBe(7069);

    render(
      <PaymentConfirmationModal
        {...baseProps}
        subtotal={112931}
        taxAmount={0}
        total={112931}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.getByText("Cambio")).toBeInTheDocument();
    expect(renderedChange()).toContain(fmtRaw("7.069"));
    expect(
      screen.getByRole("button", { name: /Confirmar pago/i }),
    ).toBeEnabled();
  });

  it("shows the overpaid amount when cash is the smaller of the two tenders", () => {
    // 20.000 cash + 100.000 card on a 112.931 total: the excess is still change
    // because cash is present and each tender alone leaves the total uncovered.
    const paymentMethods = [
      { type: "CASH", amount: 20000 },
      { type: "CARD", amount: 100000 },
    ] as PaymentMethod[];

    expect(serverChange(112931, paymentMethods)).toBe(7069);

    render(
      <PaymentConfirmationModal
        {...baseProps}
        subtotal={112931}
        taxAmount={0}
        total={112931}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.getByText("Cambio")).toBeInTheDocument();
    expect(renderedChange()).toContain(fmtRaw("7.069"));
    expect(
      screen.queryByText("Las tarjetas y transferencias no dan cambio"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Sobra un pago: con los demás métodos ya se cubre el total"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirmar pago/i }),
    ).toBeEnabled();
  });

  it("does not read a tax-rounded total a fraction off as change or as a problem", () => {
    // The page total is a JS float (net 1006 + 19% → 1197.1399999999999) while the
    // server persists the line tax rounded to cents. Paying the displayed total by
    // card is an exact payment, never a surplus and never a missing cash tender.
    const paymentMethods = [{ type: "CARD", amount: 1197.14 }] as PaymentMethod[];

    render(
      <PaymentConfirmationModal
        {...baseProps}
        subtotal={1006}
        taxAmount={191.13999999999987}
        total={1197.1399999999999}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Las tarjetas y transferencias no dan cambio"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirmar pago/i }),
    ).toBeEnabled();
  });

  it("disables the confirm and explains a surplus tender the rest already covers", () => {
    const paymentMethods = [
      { type: "CASH", amount: 112931 },
      { type: "TRANSFER", amount: 100000 },
    ] as PaymentMethod[];

    render(
      <PaymentConfirmationModal
        {...baseProps}
        subtotal={112931}
        taxAmount={0}
        total={112931}
        paymentMethods={paymentMethods}
      />,
    );

    // An unreachable preview must never print a change the server refuses.
    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
    expect(
      screen.getByText("Sobra un pago: con los demás métodos ya se cubre el total"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirmar pago/i }),
    ).toBeDisabled();
  });

  it("disables the confirm when only a card overpays, since cards give no change", () => {
    const paymentMethods = [{ type: "CARD", amount: 120000 }] as PaymentMethod[];

    render(
      <PaymentConfirmationModal
        {...baseProps}
        subtotal={112931}
        taxAmount={0}
        total={112931}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
    expect(
      screen.getByText("Las tarjetas y transferencias no dan cambio"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirmar pago/i }),
    ).toBeDisabled();
  });

  it("disables the confirm when a transfer and a card overpay together", () => {
    const paymentMethods = [
      { type: "TRANSFER", amount: 50000 },
      { type: "CARD", amount: 70000 },
    ] as PaymentMethod[];

    render(
      <PaymentConfirmationModal
        {...baseProps}
        subtotal={112931}
        taxAmount={0}
        total={112931}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.queryByText("Cambio")).not.toBeInTheDocument();
    expect(
      screen.getByText("Las tarjetas y transferencias no dan cambio"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirmar pago/i }),
    ).toBeDisabled();
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
