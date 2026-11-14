import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileCartFloatingBar } from "./MobileCartFloatingBar";
import type { CartItem, Product } from "@/types";

const mockProduct: Product = {
  id: "prod-1",
  name: "Aceite 4T",
  sku: "OIL-4T",
  barcode: null,
  description: null,
  costPrice: 20000,
  salePrice: 35000,
  taxRate: 19,
  stock: 5,
  minStock: 1,
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
  quantity: 3,
  unitPrice: 35000,
  originalUnitPrice: 35000,
  availableStock: 5,
  discountAmount: 0,
};

describe("MobileCartFloatingBar", () => {
  it("renders nothing when cart is empty", () => {
    const { container } = render(
      <MobileCartFloatingBar cart={[]} total={0} onClick={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders floating bar with total items and sum, and triggers onClick when tapped", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(
      <MobileCartFloatingBar
        cart={[mockCartItem]}
        total={105000}
        onClick={handleClick}
      />,
    );

    expect(screen.getByText("Ver carrito")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Abrir")).toBeInTheDocument();

    const barButton = screen.getByRole("button", { name: /Ver carrito/i });
    await user.click(barButton);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
