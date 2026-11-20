import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CartLine } from "./CartLine";
import type { CartItem, Product } from "@/types";
import { formatCurrency } from "@/lib/utils";

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

function renderLine(
  overrides: Partial<CartItem> = {},
  handlers: {
    onQuantityChange?: (productId: string, quantity: number) => void;
    onDiscount?: (productId: string) => void;
    onRemove?: (productId: string) => void;
    variant?: "default" | "compact";
  } = {},
) {
  const item = { ...mockCartItem, ...overrides };
  const onQuantityChange = handlers.onQuantityChange ?? vi.fn();
  const onDiscount = handlers.onDiscount ?? vi.fn();
  const onRemove = handlers.onRemove ?? vi.fn();

  render(
    <CartLine
      item={item}
      variant={handlers.variant}
      onQuantityChange={onQuantityChange}
      onDiscount={onDiscount}
      onRemove={onRemove}
    />,
  );

  return { item, onQuantityChange, onDiscount, onRemove };
}

describe("CartLine", () => {
  it("renders the product image as the full-height thumbnail when the product has one", () => {
    renderLine({
      product: { ...mockProduct, imageUrl: "https://cdn.example.com/bujia.jpg" },
    });

    const thumbnail = screen.getByTestId("cart-line-image");
    const image = thumbnail.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("alt", "Bujía NGK Racing");
    expect(thumbnail.className).toContain("self-stretch");
    expect(thumbnail.className).toContain("rounded-lg");
  });

  it("falls back to a muted icon tile when the product has no image", () => {
    renderLine();

    const thumbnail = screen.getByTestId("cart-line-image");
    expect(thumbnail.querySelector("img")).toBeNull();
    expect(thumbnail.querySelector("svg")).not.toBeNull();
    expect(thumbnail.className).toContain("bg-muted");
  });

  it("shows the unit price per unit, the quantity and the scaled line total", () => {
    renderLine({ quantity: 3, unitPrice: 8900, originalUnitPrice: 8900 });

    const unitPrice = screen.getByTestId("line-unit-price");
    expect(unitPrice.textContent).toContain(formatCurrency(8900));
    expect(unitPrice.textContent).toContain("c/u");

    expect(screen.getByRole("textbox", { name: "Cantidad" })).toHaveValue("3");

    const total = screen.getByTestId("cart-line-total");
    expect(total.textContent).toBe(formatCurrency(26700));
    expect(total.className).toContain("text-lg");
    expect(total.className).toContain("font-semibold");
    expect(total.className).toContain("tabular-nums");
  });

  it("reflects the line discount as a chip plus the struck pre-discount subtotal", () => {
    renderLine({ quantity: 2, unitPrice: 25000, discountAmount: 5000 });

    const chip = screen.getByTestId("line-discount");
    expect(chip.textContent).toContain(formatCurrency(5000));

    expect(screen.getByTestId("cart-line-total").textContent).toBe(
      formatCurrency(45000),
    );

    const struck = screen.getByTestId("cart-line-gross");
    expect(struck.tagName.toLowerCase()).toBe("s");
    expect(struck.textContent).toBe(formatCurrency(50000));
  });

  it("asks for the neighbouring quantity when the stepper is used", async () => {
    const user = userEvent.setup();
    const onQuantityChange = vi.fn();
    renderLine({ quantity: 2 }, { onQuantityChange });

    await user.click(screen.getByRole("button", { name: "Aumentar cantidad" }));
    expect(onQuantityChange).toHaveBeenLastCalledWith("prod-1", 3);

    await user.click(screen.getByRole("button", { name: "Disminuir cantidad" }));
    expect(onQuantityChange).toHaveBeenLastCalledWith("prod-1", 1);
  });

  it("clamps a typed quantity to the available stock", async () => {
    const user = userEvent.setup();
    const onQuantityChange = vi.fn();
    renderLine({ quantity: 2, availableStock: 10 }, { onQuantityChange });

    await user.type(screen.getByRole("textbox", { name: "Cantidad" }), "0");

    expect(onQuantityChange).toHaveBeenLastCalledWith("prod-1", 10);
  });

  it("blocks the increment and flags the maximum at the stock limit", async () => {
    const user = userEvent.setup();
    const onQuantityChange = vi.fn();
    renderLine({ quantity: 3, availableStock: 3 }, { onQuantityChange });

    const increment = screen.getByRole("button", { name: "Aumentar cantidad" });
    expect(increment).toBeDisabled();
    expect(screen.getByText("máx.")).toBeInTheDocument();

    await user.click(increment);
    expect(onQuantityChange).not.toHaveBeenCalled();
  });

  it("fires the discount and remove callbacks for the line's product", async () => {
    const user = userEvent.setup();
    const onDiscount = vi.fn();
    const onRemove = vi.fn();
    renderLine({}, { onDiscount, onRemove });

    await user.click(
      screen.getByRole("button", { name: "Descuento para Bujía NGK Racing" }),
    );
    expect(onDiscount).toHaveBeenCalledWith("prod-1");

    await user.click(
      screen.getByRole("button", { name: "Eliminar Bujía NGK Racing" }),
    );
    expect(onRemove).toHaveBeenCalledWith("prod-1");
  });

  it("separates an active promotion from a manual price override", () => {
    // Promo price comes from the server: the line is on offer, not overridden.
    renderLine({
      product: { ...mockProduct, effectiveSalePrice: 20000 },
      unitPrice: 20000,
      originalUnitPrice: 25000,
    });

    expect(screen.getByText("Oferta -20%")).toBeInTheDocument();
    expect(screen.queryByTestId("price-overridden")).toBeNull();

    cleanup();

    // A price that differs from the server-derived price is a manual override.
    renderLine({
      product: { ...mockProduct, effectiveSalePrice: 20000 },
      unitPrice: 18000,
      originalUnitPrice: 25000,
    });

    expect(screen.getByTestId("price-overridden").textContent).toContain(
      "Precio ajustado",
    );
  });

  it("keeps the compact variant to one name line for the mobile drawer", () => {
    renderLine({}, { variant: "compact" });

    const name = screen.getByText("Bujía NGK Racing");
    expect(name.className).toContain("line-clamp-1");
    expect(screen.getByTestId("cart-line-image").className).toContain("w-14");
    // Thumb-sized targets: the drawer's delete action sits beside the stepper.
    expect(
      screen.getByRole("button", { name: "Eliminar Bujía NGK Racing" }).className,
    ).toContain("h-11 w-11");
  });
});
