import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileCartDrawer } from "./MobileCartDrawer";
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

  it("presents the cart as a drag-to-dismiss bottom sheet", () => {
    const handleClose = vi.fn();
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(
        () =>
          ({
            top: 0,
            bottom: 600,
            left: 0,
            right: 390,
            width: 390,
            height: 600,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }) as DOMRect,
      );

    render(
      <MobileCartDrawer
        isOpen={true}
        onClose={handleClose}
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

    const sheet = screen.getByRole("dialog", { name: "Carrito de compras" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet.closest("[data-bottom-sheet]")).not.toBeNull();
    expect(sheet.closest("[data-bottom-sheet]")!.className).toContain("lg:hidden");
    expect(sheet.querySelector("[data-bottom-sheet-handle]")).not.toBeNull();
    // The checkout bar is pinned outside the scrolling body.
    expect(sheet.querySelector("[data-bottom-sheet-footer]")).not.toBeNull();

    const handle = sheet.querySelector<HTMLElement>("[data-bottom-sheet-handle]")!;
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1, pointerType: "touch" });
    nowSpy.mockReturnValue(600);
    fireEvent.pointerUp(handle, { clientY: 400, pointerId: 1, pointerType: "touch" });
    nowSpy.mockRestore();
    rectSpy.mockRestore();

    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
