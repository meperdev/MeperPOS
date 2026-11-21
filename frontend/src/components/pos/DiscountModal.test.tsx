import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscountModal } from "./DiscountModal";
import { formatCurrency } from "@/lib/utils";
import type { CartItem, Product } from "@/types";

const mockProduct: Product = {
  id: "prod-1",
  name: "Bujía NGK Racing",
  sku: "BUJ-001",
  barcode: null,
  description: null,
  costPrice: 15000,
  salePrice: 25000,
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
};

const mockCartItem: CartItem = {
  productId: "prod-1",
  product: mockProduct,
  quantity: 2,
  unitPrice: 25000,
  originalUnitPrice: 25000,
  availableStock: 10,
  discountAmount: 0,
};

function setup(
  overrides: Partial<CartItem> = {},
  canOverridePrice = true,
) {
  const onClose = vi.fn();
  const onApplyDiscount = vi.fn();
  const onApplyDiscountPercent = vi.fn();
  const onApplyPrice = vi.fn();

  render(
    <DiscountModal
      isOpen
      item={{ ...mockCartItem, ...overrides }}
      canOverridePrice={canOverridePrice}
      onClose={onClose}
      onApplyDiscount={onApplyDiscount}
      onApplyDiscountPercent={onApplyDiscountPercent}
      onApplyPrice={onApplyPrice}
    />,
  );

  return { onClose, onApplyDiscount, onApplyDiscountPercent, onApplyPrice };
}

/**
 * The dialog moves focus into its panel one frame after it opens. Waiting for
 * that move keeps a test keystroke from racing it (jsdom shares the frame
 * timer with the typing helper).
 */
async function settleDialogFocus() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("DiscountModal", () => {
  it("opens on the line summary with the product, the quantity and the current unit price", async () => {
    setup();
    await settleDialogFocus();

    const summary = screen.getByTestId("discount-modal-item");
    expect(summary.textContent).toContain("Bujía NGK Racing");
    expect(summary.textContent).toContain("2");
    expect(summary.textContent).toContain(formatCurrency(25000));
    expect(summary.textContent).toContain("c/u");
  });

  it("applies a fixed discount from the default discount mode", async () => {
    const user = userEvent.setup();
    const { onApplyDiscount } = setup();
    await settleDialogFocus();

    const apply = screen.getByRole("button", { name: "Aplicar descuento" });
    // Nothing typed yet: there is no change to apply.
    expect(apply).toBeDisabled();

    await user.type(screen.getByLabelText("Monto del descuento"), "5000");
    expect(apply).toBeEnabled();

    await user.click(apply);
    expect(onApplyDiscount).toHaveBeenCalledWith("prod-1", 5000);
  });

  it("switches to the final-price mode and applies the typed unit price", async () => {
    const user = userEvent.setup();
    const { onApplyPrice } = setup();
    await settleDialogFocus();

    await user.click(screen.getByRole("button", { name: "Precio final" }));

    const input = screen.getByLabelText("Nuevo precio unitario");
    await user.clear(input);
    await user.type(input, "20000");

    await user.click(screen.getByRole("button", { name: "Aplicar precio" }));
    expect(onApplyPrice).toHaveBeenCalledWith("prod-1", 20000);
  });

  it("disables the final-price action while the price is unchanged or empty", async () => {
    const user = userEvent.setup();
    setup();
    await settleDialogFocus();

    await user.click(screen.getByRole("button", { name: "Precio final" }));
    const apply = screen.getByRole("button", { name: "Aplicar precio" });

    // The field opens on the current unit price, so it starts as "no change".
    expect(screen.getByLabelText("Nuevo precio unitario")).toHaveValue("25.000");
    expect(apply).toBeDisabled();

    await user.clear(screen.getByLabelText("Nuevo precio unitario"));
    expect(apply).toBeDisabled();
  });

  it("sets the value from a quick chip and applies it as a percentage", async () => {
    const user = userEvent.setup();
    const { onApplyDiscountPercent } = setup();
    await settleDialogFocus();

    const chip = screen.getByRole("button", { name: "10%" });
    await user.click(chip);

    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Monto del descuento")).toHaveValue("10");
    expect(screen.getByRole("button", { name: "5%" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Aplicar descuento" }));
    expect(onApplyDiscountPercent).toHaveBeenCalledWith("prod-1", 10);
  });

  it("previews the original price, the final price and the saving", async () => {
    const user = userEvent.setup();
    setup();
    await settleDialogFocus();

    // Untouched: nothing is struck through and there is no saving yet.
    expect(
      screen.getByTestId("discount-preview-original").className,
    ).not.toContain("line-through");
    expect(screen.queryByTestId("discount-preview-savings")).toBeNull();

    await user.click(screen.getByRole("button", { name: "10%" }));

    // 2 × 25.000 = 50.000; a 10% rebate saves 5.000 and leaves 22.500 per unit.
    expect(
      screen.getByTestId("discount-preview-original").className,
    ).toContain("line-through");
    expect(screen.getByTestId("discount-preview-final").textContent).toBe(
      formatCurrency(22500),
    );
    const saving = screen.getByTestId("discount-preview-savings");
    expect(saving.textContent).toContain(formatCurrency(5000));
    expect(saving.textContent).toContain("10%");
    expect(saving.className).toContain("text-success-text");
  });

  it("switches between pesos and percentage, clearing a value that no longer means the same", async () => {
    const user = userEvent.setup();
    setup();
    await settleDialogFocus();

    await user.type(screen.getByLabelText("Monto del descuento"), "5000");
    await user.click(screen.getByRole("button", { name: "%" }));

    expect(screen.getByLabelText("Monto del descuento")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Aplicar descuento" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "%" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("refuses a rebate larger than the line instead of letting the total go negative", async () => {
    const user = userEvent.setup();
    const { onApplyDiscount } = setup();
    await settleDialogFocus();

    const field = screen.getByLabelText("Monto del descuento");
    await user.type(field, "99999");

    expect(
      screen.getByRole("button", { name: "Aplicar descuento" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/no puede superar el total de la línea/i),
    ).toBeTruthy();

    // The whole line is a valid rebate: the total floors at zero, never below.
    await user.clear(field);
    await user.type(field, "50000");

    expect(
      screen.getByRole("button", { name: "Aplicar descuento" }),
    ).toBeEnabled();
    expect(screen.getByTestId("discount-preview-final").textContent).toBe(
      formatCurrency(0),
    );

    await user.click(screen.getByRole("button", { name: "Aplicar descuento" }));
    expect(onApplyDiscount).toHaveBeenCalledWith("prod-1", 50000);
  });

  it("offers only the discount mode to a role that cannot override the price", async () => {
    setup({}, false);
    await settleDialogFocus();

    expect(screen.queryByRole("button", { name: "Precio final" })).toBeNull();
    expect(screen.queryByLabelText("Nuevo precio unitario")).toBeNull();
    expect(screen.getByLabelText("Monto del descuento")).toBeTruthy();
  });

  it("closes through Cancelar without touching the line", async () => {
    const user = userEvent.setup();
    const { onClose, onApplyDiscount } = setup();
    await settleDialogFocus();

    await user.type(screen.getByLabelText("Monto del descuento"), "5000");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApplyDiscount).not.toHaveBeenCalled();
  });

  it("surfaces an invalid percentage instead of applying it", async () => {
    const user = userEvent.setup();
    setup();
    await settleDialogFocus();

    await user.click(screen.getByRole("button", { name: "%" }));
    await user.type(screen.getByLabelText("Monto del descuento"), "120");

    // Percentages live between 1 and 100.
    expect(
      screen.getByRole("button", { name: "Aplicar descuento" }),
    ).toBeDisabled();
  });

  it("keeps the percentage shape when the line already carries one", async () => {
    const user = userEvent.setup();
    const { onApplyDiscountPercent } = setup({
      discountAmount: 5000,
      discountPercent: 10,
    });
    await settleDialogFocus();

    const apply = screen.getByRole("button", { name: "Aplicar descuento" });
    // The line already carries 10%: re-applying it changes nothing.
    await user.click(screen.getByRole("button", { name: "10%" }));
    expect(apply).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "20%" }));
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(onApplyDiscountPercent).toHaveBeenCalledWith("prod-1", 20);
  });
});
