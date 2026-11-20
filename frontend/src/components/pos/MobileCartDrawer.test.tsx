import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileCartDrawer } from "./MobileCartDrawer";
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

describe("MobileCartDrawer", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <MobileCartDrawer
        isOpen={false}
        onClose={vi.fn()}
        cart={[mockCartItem]}
        subtotal={50000}
        taxAmount={0}
        discountAmount={0}
        total={50000}
        selectedCustomerName={null}
        onOpenCustomerModal={vi.fn()}
        pausedSalesCount={0}
        onOpenPausedSales={vi.fn()}
        onPauseSale={vi.fn()}
        selectedPaymentMethod="CASH"
        onPaymentMethodChange={vi.fn()}
        onUpdateQuantity={vi.fn()}
        onOpenDiscountModal={vi.fn()}
        onRemoveFromCart={vi.fn()}
        onCheckout={vi.fn()}
        onFinance={vi.fn()}
        canFinance={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders cart items, customer selector and triggers checkout when open", async () => {
    const user = userEvent.setup();
    const handleCheckout = vi.fn();
    const handleClose = vi.fn();
    const handleUpdateQuantity = vi.fn();
    const handleRemoveFromCart = vi.fn();

    render(
      <MobileCartDrawer
        isOpen={true}
        onClose={handleClose}
        cart={[mockCartItem]}
        subtotal={50000}
        taxAmount={0}
        discountAmount={0}
        total={50000}
        selectedCustomerName="Juan Pérez"
        onOpenCustomerModal={vi.fn()}
        pausedSalesCount={1}
        onOpenPausedSales={vi.fn()}
        onPauseSale={vi.fn()}
        selectedPaymentMethod="CASH"
        onPaymentMethodChange={vi.fn()}
        onUpdateQuantity={handleUpdateQuantity}
        onOpenDiscountModal={vi.fn()}
        onRemoveFromCart={handleRemoveFromCart}
        onCheckout={handleCheckout}
        onFinance={vi.fn()}
        canFinance={true}
      />,
    );

    expect(screen.getByText("Carrito de compras")).toBeInTheDocument();
    expect(screen.getByText("Bujía NGK Racing")).toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();

    const checkoutButton = screen.getByRole("button", { name: /Cobrar/i });
    await user.click(checkoutButton);
    expect(handleCheckout).toHaveBeenCalledTimes(1);

    const financeButton = screen.getByRole("button", { name: /Financiar/i });
    expect(financeButton).toBeEnabled();

    const closeButton = screen.getByRole("button", { name: /Cerrar carrito/i });
    await user.click(closeButton);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("renders each drawer line through the shared compact CartLine", async () => {
    const user = userEvent.setup();
    const handleUpdateQuantity = vi.fn();
    const handleOpenDiscountModal = vi.fn();

    render(
      <MobileCartDrawer
        isOpen={true}
        onClose={vi.fn()}
        cart={[mockCartItem]}
        subtotal={50000}
        taxAmount={0}
        discountAmount={0}
        total={50000}
        selectedCustomerName={null}
        onOpenCustomerModal={vi.fn()}
        pausedSalesCount={0}
        onOpenPausedSales={vi.fn()}
        onPauseSale={vi.fn()}
        selectedPaymentMethod="CASH"
        onPaymentMethodChange={vi.fn()}
        onUpdateQuantity={handleUpdateQuantity}
        onOpenDiscountModal={handleOpenDiscountModal}
        onRemoveFromCart={vi.fn()}
        onCheckout={vi.fn()}
        onFinance={vi.fn()}
        canFinance={false}
      />,
    );

    // Same data as before the swap: unit price, quantity and the line total.
    expect(screen.getByTestId("line-unit-price").textContent).toContain(
      formatCurrency(25000),
    );
    expect(screen.getByRole("textbox", { name: "Cantidad" })).toHaveValue("2");
    expect(screen.getByTestId("cart-line-total").textContent).toBe(
      formatCurrency(50000),
    );

    await user.click(screen.getByRole("button", { name: "Aumentar cantidad" }));
    expect(handleUpdateQuantity).toHaveBeenCalledWith("prod-1", 3);

    await user.click(
      screen.getByRole("button", { name: "Descuento para Bujía NGK Racing" }),
    );
    expect(handleOpenDiscountModal).toHaveBeenCalledWith("prod-1");
  });
});
