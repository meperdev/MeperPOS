import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductCard } from "@/components/products/ProductCard";
import { formatCurrency } from "@/lib/utils";

const baseProduct = {
  id: "p-1",
  name: "Camisa de lino natural",
  sku: "SKU-0001",
  imageUrl: null,
  stock: 20,
  salePrice: 45000,
  // The server ships the low-stock flag; the card renders it and never re-derives it.
  isLowStock: false,
  category: { name: "Ropa" },
  active: true,
};

describe("ProductCard inventory mode — status chip", () => {
  it("shows 'Activo' chip with a luminous dot when stock is healthy", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);

    const chip = screen.getByText("Activo");
    expect(chip).toBeInTheDocument();
    // single dot, no duplicate bullet char
    expect(screen.queryByText("•")).toBeNull();
  });

  it("shows 'Stock bajo' chip with alert dot when the server flags low stock", () => {
    render(
      <ProductCard
        product={{ ...baseProduct, stock: 3, isLowStock: true }}
        mode="inventory"
      />,
    );

    expect(screen.getByText("Stock bajo")).toBeInTheDocument();
    expect(screen.getByTestId("stock-alert-icon")).toBeInTheDocument();
  });

  it("does not show 'Stock bajo' when the numbers would qualify but the server flag is false", () => {
    // The drift this guards: an untracked product can carry stale stock/minStock. The
    // server rule says false, so the card must read the flag, not the arithmetic.
    render(
      <ProductCard
        product={{ ...baseProduct, stock: 1, isLowStock: false }}
        mode="inventory"
      />,
    );

    expect(screen.queryByText("Stock bajo")).toBeNull();
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });

  it("shows 'Agotado' chip when stock is 0", () => {
    render(
      <ProductCard
        // A tracked product at zero IS low on stock server-side, so the flag is true here:
        // "Agotado" must still win the status chain over the lower-severity low stock.
        product={{ ...baseProduct, stock: 0, isLowStock: true }}
        mode="inventory"
      />,
    );

    expect(screen.getByText("Agotado")).toBeInTheDocument();
    expect(screen.getByTestId("stock-alert-icon")).toBeInTheDocument();
  });

  it("shows a 'Servicio' chip instead of an 'Agotado' chip when the item is a service", () => {
    render(
      <ProductCard
        product={{ ...baseProduct, type: "SERVICE", stock: 0 }}
        mode="inventory"
      />,
    );

    const chip = screen.getByTestId("service-chip");
    expect(chip.textContent?.trim()).toBe("Servicio");

    // A service is sold labour: it can never be out of stock, so neither the out-of-stock
    // nor the low-stock chip may appear, and the stock badge must not read "0 uds.".
    expect(screen.queryByText("Agotado")).toBeNull();
    expect(screen.queryByText("Stock bajo")).toBeNull();
    expect(screen.queryByTestId("stock-alert-icon")).toBeNull();

    // The chip already carries the fact: no duplicate stock pill for a service.
    expect(screen.queryByTestId("product-stock")).toBeNull();
    expect(screen.queryByText("0 uds.")).toBeNull();
  });

  it("shows a 'Sin inventario' chip instead of an 'Agotado' chip when the product is untracked", () => {
    render(
      <ProductCard
        product={{
          ...baseProduct,
          type: "PRODUCT",
          tracksStock: false,
          stock: 0,
        }}
        mode="inventory"
      />,
    );

    const chip = screen.getByTestId("untracked-chip");
    expect(chip.textContent?.trim()).toBe("Sin inventario");

    // An untracked product is real merchandise nobody counts: it can never be out of
    // stock nor low on stock, so no stock alert chip may appear, and the stock badge
    // must not read the stored "0 uds.".
    expect(screen.queryByText("Agotado")).toBeNull();
    expect(screen.queryByText("Stock bajo")).toBeNull();
    expect(screen.queryByTestId("stock-alert-icon")).toBeNull();

    // The chip already says it: no duplicate "Sin inventario" stock pill, and never "0 uds.".
    expect(screen.queryByTestId("product-stock")).toBeNull();
    expect(screen.queryByText("0 uds.")).toBeNull();
  });

  it("does not show stock alerts for untracked goods even when stored stock is low", () => {
    render(
      <ProductCard product={{ ...baseProduct, tracksStock: false, stock: 3 }} mode="inventory" />,
    );

    expect(screen.getByTestId("untracked-chip")).toHaveTextContent("Sin inventario");
    expect(screen.queryByTestId("product-stock")).toBeNull();
    expect(screen.queryByText("3 uds.")).toBeNull();
    expect(screen.queryByTestId("stock-alert-icon")).toBeNull();
  });

  it.each([true, null, undefined])("shows stored stock for tracked goods with tracksStock=%s", (flag) => {
    render(
      <ProductCard product={{ ...baseProduct, tracksStock: flag, stock: 7 }} mode="inventory" />,
    );

    expect(screen.getByText("7 uds.")).toBeInTheDocument();
    expect(screen.queryByTestId("untracked-chip")).toBeNull();
  });

  it("keeps service status ahead of the untracked flag", () => {
    render(
      <ProductCard product={{ ...baseProduct, type: "SERVICE", tracksStock: false, stock: 0 }} mode="inventory" />,
    );

    expect(screen.getByTestId("service-chip")).toHaveTextContent("Servicio");
    expect(screen.queryByTestId("product-stock")).toBeNull();
    expect(screen.queryByTestId("untracked-chip")).toBeNull();
  });

  it("keeps inactive status ahead of the untracked flag", () => {
    render(
      <ProductCard product={{ ...baseProduct, tracksStock: false, stock: 0, active: false }} mode="inventory" />,
    );

    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.queryByTestId("untracked-chip")).toBeNull();
    expect(screen.queryByTestId("stock-alert-icon")).toBeNull();
  });

  it("shows 'Inactivo' rather than 'Servicio' when a service has been deactivated", () => {
    render(
      <ProductCard
        product={{
          ...baseProduct,
          type: "SERVICE",
          stock: 0,
          active: false,
        }}
        mode="inventory"
      />,
    );

    // Deactivating a service must stay visible: a service is sold labour that can never be
    // out of stock, but the inactive state still wins over the type, so the state chip is
    // neither the service chip nor an out-of-stock chip.
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.queryByTestId("service-chip")).toBeNull();
    expect(screen.queryByTestId("stock-alert-icon")).toBeNull();
  });
});

describe("ProductCard inventory mode — separate price and stock", () => {
  it("renders stock count apart from the price panel", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);
    expect(screen.getByText("20 uds.")).toBeInTheDocument();
    expect(screen.getByTestId("product-price-panel")).not.toContainElement(screen.getByTestId("product-stock"));
  });

  it("renders the formatted COP price", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);
    expect(screen.getByText("$ 45.000")).toBeInTheDocument();
  });
});

describe("ProductCard inventory mode — inactive state", () => {
  it("renders 'Inactivo' badge and dims the card when product.active === false", () => {
    const { container } = render(
      <ProductCard
        product={{ ...baseProduct, active: false }}
        mode="inventory"
      />,
    );

    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("opacity-60");
  });

  it("does NOT render 'Inactivo' badge when product is active", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);
    expect(screen.queryByText("Inactivo")).toBeNull();
  });
});

describe("ProductCard inventory mode — sku below the name", () => {
  it("renders the SKU under the product name", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);
    expect(screen.getByText("SKU-0001")).toBeInTheDocument();
  });
});

describe("ProductCard inventory mode — footer action", () => {
  it("does NOT render any footer button when neither onDelete nor onReactivate is provided", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders 'Desactivar' when onDelete is provided and calls it without propagating the click", async () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <ProductCard
        product={baseProduct}
        mode="inventory"
        onClick={onClick}
        onDelete={onDelete}
      />,
    );

    const button = screen.getByRole("button", { name: /desactivar producto/i });
    await user.click(button);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders 'Reactivar' when onReactivate is provided (and onDelete is not)", async () => {
    const onReactivate = vi.fn();
    const user = userEvent.setup();

    render(
      <ProductCard
        product={{ ...baseProduct, active: false }}
        mode="inventory"
        onReactivate={onReactivate}
      />,
    );

    const button = screen.getByRole("button", { name: /reactivar producto/i });
    await user.click(button);

    expect(onReactivate).toHaveBeenCalledTimes(1);
  });
});

describe("ProductCard inventory mode — full-card edit target", () => {
  it("exposes an edge-to-edge edit button over the media, details, and empty card space", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <ProductCard product={baseProduct} mode="inventory" onClick={onEdit} />,
    );

    const card = container.firstElementChild;
    // With the explicit rail edit button gone, exactly one control opens the editor.
    const editTarget = screen.getByRole("button", { name: /editar producto: camisa de lino natural/i });
    expect(screen.queryByRole("button", { name: /^editar producto$/i })).toBeNull();
    // JSDOM cannot hit-test CSS. An absolute inset-0 button is the full-card
    // interaction surface, including blank space that has no content element.
    expect(card).toHaveClass("relative");
    expect(editTarget).toHaveClass("absolute", "inset-0", "z-10", "rounded-[inherit]");
    expect(editTarget.parentElement).toBe(card);
    await user.click(editTarget);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("keeps deactivation outside the full-card edit target", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <ProductCard product={baseProduct} mode="inventory" onClick={onEdit} onDelete={onDelete} />,
    );

    const editTarget = screen.getByRole("button", { name: /editar producto: camisa de lino natural/i });
    const deactivate = screen.getByRole("button", { name: /desactivar producto/i });
    expect(editTarget).not.toContainElement(deactivate);
    expect(container.querySelector("button button")).toBeNull();
    await user.click(deactivate);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    await user.click(editTarget);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps reactivation outside the full-card edit target for inactive products", async () => {
    const onEdit = vi.fn();
    const onReactivate = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductCard product={{ ...baseProduct, active: false }} mode="inventory" onClick={onEdit} onReactivate={onReactivate} />,
    );

    const editTarget = screen.getByRole("button", { name: /editar producto: camisa de lino natural/i });
    const reactivate = screen.getByRole("button", { name: /reactivar producto/i });
    expect(editTarget).toHaveClass("absolute", "inset-0");
    expect(editTarget).not.toContainElement(reactivate);
    await user.click(reactivate);
    expect(onReactivate).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("ProductCard inventory mode — keyboard accessibility", () => {
  it("activates onClick with Enter key when focused", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <ProductCard product={baseProduct} mode="inventory" onClick={onClick} />,
    );

    const card = screen.getByRole("button", {
      name: /editar producto: camisa de lino natural/i,
    });
    card.focus();
    await user.keyboard("{Enter}");

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("activates onClick with Space key when focused", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <ProductCard product={baseProduct} mode="inventory" onClick={onClick} />,
    );

    const card = screen.getByRole("button", {
      name: /editar producto: camisa de lino natural/i,
    });
    card.focus();
    await user.keyboard(" ");

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("ProductCard inventory mode — category chip", () => {
  it("renders the category name when provided", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);
    expect(screen.getByText("Ropa")).toBeInTheDocument();
  });

  it("renders 'Sin categoría' when category is null", () => {
    render(
      <ProductCard
        product={{ ...baseProduct, category: null }}
        mode="inventory"
      />,
    );
    expect(screen.getByText("Sin categoría")).toBeInTheDocument();
  });
});

describe("ProductCard — offer badge and strikethrough (#74)", () => {
  it("renders an 'Oferta' badge and strikes through the list price when a promo is active", () => {
    render(
      <ProductCard
        product={{
          ...baseProduct,
          salePrice: 10000,
          effectiveSalePrice: 8000,
          promotionType: "PERCENTAGE",
          promotionValue: 20,
        }}
        mode="inventory"
      />,
    );

    expect(screen.getByText(/Oferta/)).toBeInTheDocument();
    // The tag carries the approximate discount %.
    expect(screen.getByText(/Oferta/).textContent).toContain("-20%");

    const listPrice = screen.getByTestId("offer-list-price");
    expect(listPrice).toHaveClass("line-through");
    expect(listPrice.textContent).toContain(formatCurrency(10000));
    expect(screen.getByTestId("offer-effective-price").textContent).toContain(
      formatCurrency(8000),
    );
  });

  it("detects the offer even when salePrice arrives as a numeric string (Decimal)", () => {
    render(
      <ProductCard
        product={{
          ...baseProduct,
          salePrice: "10000" as unknown as number,
          effectiveSalePrice: 8000,
          promotionType: "PERCENTAGE",
          promotionValue: 20,
        }}
        mode="inventory"
      />,
    );

    expect(screen.getByText(/Oferta/)).toBeInTheDocument();
    expect(screen.getByText(/Oferta/).textContent).toContain("-20%");
    expect(screen.getByTestId("offer-list-price").textContent).toContain(
      formatCurrency(10000),
    );
    expect(screen.getByTestId("offer-effective-price").textContent).toContain(
      formatCurrency(8000),
    );
  });

  it("renders neither the 'Oferta' badge nor a strikethrough without an active promo", () => {
    render(
      <ProductCard
        product={{ ...baseProduct, salePrice: 45000 }}
        mode="inventory"
      />,
    );

    expect(screen.queryByText(/Oferta/)).toBeNull();
    expect(screen.queryByTestId("offer-list-price")).toBeNull();
    expect(screen.queryByTestId("offer-effective-price")).toBeNull();
  });

  it("shows the offer price and badge in POS mode too", () => {
    render(
      <ProductCard
        product={{
          ...baseProduct,
          salePrice: 19900,
          effectiveSalePrice: 16915,
          promotionType: "PERCENTAGE",
          promotionValue: 15,
        }}
        mode="pos"
        onClick={() => {}}
      />,
    );

    expect(screen.getByText(/Oferta/)).toBeInTheDocument();
    expect(screen.getByText(/Oferta/).textContent).toContain("-15%");
    expect(screen.getByTestId("offer-list-price").textContent).toContain(
      formatCurrency(19900),
    );
    expect(screen.getByTestId("offer-effective-price").textContent).toContain(
      formatCurrency(16915),
    );
  });
});

describe("ProductCard — responsive action and price hierarchy", () => {
  it("gives POS a full-card add button that invokes the cart action once without a duplicate rail add button", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<ProductCard product={baseProduct} mode="pos" onClick={onAdd} />);

    const add = screen.getByRole("button", { name: /agregar al carrito: camisa de lino natural/i });
    expect(add.tagName).toBe("BUTTON");
    expect(screen.queryByRole("button", { name: /^\+ agregar$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /editar producto/i })).toBeNull();
    await user.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("keeps the POS media/body clickable and keyboard-operable without nesting action buttons", async () => {
    const onAdd = vi.fn();
    const onToggleFavorite = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <ProductCard product={baseProduct} mode="pos" onClick={onAdd} onToggleFavorite={onToggleFavorite} />,
    );

    const cardAction = screen.getByRole("button", { name: /agregar al carrito: camisa de lino natural/i });
    expect(cardAction.tagName).toBe("BUTTON");
    expect(container.querySelector("button button")).toBeNull();
    await user.click(cardAction);
    cardAction.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onAdd).toHaveBeenCalledTimes(3);
    expect(onToggleFavorite).not.toHaveBeenCalled();
  });

  it("keeps inventory management actions separate from POS add", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductCard
        product={baseProduct}
        mode="inventory"
        onClick={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.queryByRole("button", { name: /^\+ agregar$/i })).toBeNull();
    // The full-card button is the only edit control; the rail keeps deactivation alone.
    const edit = screen.getByRole("button", { name: /editar producto: camisa de lino natural/i });
    expect(screen.queryByRole("button", { name: /^editar producto$/i })).toBeNull();
    const deactivate = screen.getByRole("button", { name: /desactivar producto/i });
    expect(deactivate).toHaveAttribute("title", "Desactivar producto");
    expect(deactivate).toHaveClass("h-11", "w-11");
    expect(deactivate).not.toHaveTextContent("Desactivar");
    await user.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it.each(["pos", "inventory"] as const)(
    "prioritizes the promotional selling price and keeps quiet stock out of the price panel in %s mode",
    (mode) => {
      render(
        <ProductCard
          product={{
            ...baseProduct,
            salePrice: 10000,
            effectiveSalePrice: 8000,
            promotionType: "PERCENTAGE",
            promotionValue: 20,
          }}
          mode={mode}
        />,
      );

      const sellingPrice = screen.getByTestId("offer-effective-price");
      const listPrice = screen.getByTestId("offer-list-price");
      const stock = screen.getByText("20 uds.");
      // Keep the actual NBSP emitted by Intl.NumberFormat; the matcher normalizes it.
      expect(sellingPrice.textContent).toContain(formatCurrency(8000));
      expect(listPrice.textContent).toContain(formatCurrency(10000));
      expect(listPrice.tagName).toBe("S");
      expect(sellingPrice.compareDocumentPosition(listPrice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // Stock lives on the SKU line above the price block, never inside the price panel.
      expect(screen.getByTestId("product-price-panel")).not.toContainElement(stock);
      // A two-column phone card must not clip the actual selling price.
      expect(sellingPrice).not.toHaveClass("truncate");
    },
  );

  it.each(["pos", "inventory"] as const)(
    "allows a long SKU to wrap or ellipsize inside a narrow %s card",
    (mode) => {
      const longSku = "CAMISA-LINO-NATURAL-EXTRA-LARGA-SKU-000001";
      render(
        <ProductCard product={{ ...baseProduct, sku: longSku }} mode={mode} />,
      );

      const sku = screen.getByText(longSku);
      // JSDOM has no layout engine: assert the intrinsic overflow guard, not pixels.
      expect(sku.className).toMatch(/(?:^|\s)(?:break-all|break-words|truncate|overflow-hidden|\[overflow-wrap:anywhere\])(?=\s|$)/);
    },
  );

  it("toggles a POS favorite by keyboard without adding the product", async () => {
    const onAdd = vi.fn();
    const onToggleFavorite = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductCard
        product={baseProduct}
        mode="pos"
        onClick={onAdd}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    const favorite = screen.getByRole("button", { name: /agregar a favoritos/i });
    favorite.focus();
    await user.keyboard("{Enter}");
    await user.click(favorite);
    expect(onToggleFavorite).toHaveBeenCalledTimes(2);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("does not add inactive POS products on click or keyboard activation", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductCard
        product={{ ...baseProduct, active: false }}
        mode="pos"
        onClick={onAdd}
      />,
    );

    const card = screen.getByRole("button", { name: /agregar al carrito: camisa de lino natural/i });
    expect(card).toHaveAttribute("aria-disabled", "true");
    await user.click(card);
    card.focus();
    await user.keyboard("{Enter}");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("allows untracked goods at zero stock through POS add action", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductCard product={{ ...baseProduct, tracksStock: false, stock: 0 }} mode="pos" onClick={onAdd} />,
    );

    const card = screen.getByRole("button", { name: /agregar al carrito/i });
    expect(card).not.toBeDisabled();
    expect(card).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByTestId("untracked-chip")).toHaveTextContent("Sin inventario");
    expect(screen.queryByTestId("product-stock")).toBeNull();
    expect(screen.queryByText("0 uds.")).toBeNull();
    expect(screen.queryByTestId("stock-alert-icon")).toBeNull();
    await user.click(card);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("disables POS add action for inactive untracked goods", () => {
    render(
      <ProductCard product={{ ...baseProduct, tracksStock: false, stock: 0, active: false }} mode="pos" onClick={vi.fn()} />,
    );

    const card = screen.getByRole("button", { name: /agregar al carrito/i });
    expect(card).toBeDisabled();
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.queryByTestId("untracked-chip")).toBeNull();
  });

  it("disables cart addition for depleted goods but not stockless services", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ProductCard product={{ ...baseProduct, stock: 0 }} mode="pos" onClick={onAdd} />,
    );

    const depletedCard = screen.getByRole("button", { name: /agregar al carrito/i });
    expect(depletedCard).toHaveAttribute("disabled");
    expect(depletedCard).toHaveAttribute("aria-disabled", "true");
    await user.click(depletedCard);
    expect(onAdd).not.toHaveBeenCalled();
    rerender(
      <ProductCard
        product={{ ...baseProduct, type: "SERVICE", stock: 0 }}
        mode="pos"
        onClick={onAdd}
      />,
    );
    await user.click(screen.getByRole("button", { name: /agregar al carrito/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe("ProductCard — premium layout contract", () => {
  it("lays the photo over the whole card frame instead of an inset sub-frame", () => {
    const { container } = render(
      <ProductCard product={baseProduct} mode="inventory" />,
    );

    const card = container.firstElementChild;
    const media = screen.getByTestId("product-media");

    // The photo is the card's own background layer: a direct child, edge to edge,
    // clipped by the card radius so no inner frame ever shows around it.
    expect(card).toHaveClass("relative", "overflow-hidden");
    expect(media).toHaveClass("absolute", "inset-0");
    expect(media.parentElement).toBe(card);
  });

  it("parks status and offer chips top-left as click-through overlays, off the media layer and the content", () => {
    const { container } = render(
      <ProductCard
        product={{
          ...baseProduct,
          salePrice: 10000,
          effectiveSalePrice: 8000,
          promotionType: "PERCENTAGE",
          promotionValue: 20,
        }}
        mode="inventory"
      />,
    );

    const card = container.firstElementChild as HTMLElement;
    const media = screen.getByTestId("product-media");
    const sheet = screen.getByTestId("product-sheet");
    const status = screen.getByText("Activo");
    const offer = screen.getByText(/Oferta/);

    for (const chip of [status, offer]) {
      // A chip inside the content block would push the layout; inside the media layer it
      // would not be a sibling overlay. Neither may hold a chip.
      expect(media).not.toContainElement(chip);
      expect(sheet).not.toContainElement(chip);
      // Either the chip or one chip container is a direct child of the card, and that host
      // is absolute and click-through so it never resizes the card nor steals the click.
      const host = chip.parentElement === card ? chip : (chip.parentElement as HTMLElement);
      expect(host.parentElement).toBe(card);
      expect(host).toHaveClass("absolute", "pointer-events-none");
    }

    // One stacked container holds both chips so they never overlap each other.
    expect(status.parentElement).toBe(offer.parentElement);
    expect(status.parentElement).not.toBe(card);
    expect(status.parentElement).toHaveClass("absolute", "left-2", "top-2", "z-20", "flex", "flex-col");
  });

  it("docks the content sheet as the last layer of the card", () => {
    const { container } = render(
      <ProductCard product={baseProduct} mode="inventory" />,
    );

    const card = container.firstElementChild;
    const sheet = screen.getByTestId("product-sheet");

    expect(sheet.parentElement).toBe(card);
    expect(sheet).toHaveClass("relative", "mt-auto");
    // Reading order matches visual order: the sheet paints above the photo layer.
    expect(
      sheet.compareDocumentPosition(screen.getByTestId("product-media")) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("highlights the category with the price and keeps stock outside that panel", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);

    const panel = screen.getByTestId("product-price-panel");

    const category = screen.getByText("Ropa");
    const price = screen.getByText("$ 45.000");

    expect(panel).toContainElement(category);
    expect(panel).toContainElement(price);
    // Category reads first, the price right under it, as one highlighted unit.
    expect(category.compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No eyebrow caption and no bordered box: the unit sits straight on the photo scrim.
    expect(screen.queryByText("Precio")).toBeNull();
    expect(panel.className).not.toMatch(/(?:^|\s)border(?:-\S+)?(?=\s|$)/);
    // Stock is its own fact, never a caption of the price.
    expect(panel).not.toContainElement(screen.getByTestId("product-stock"));
  });

  it("exposes the full-card click surface as the single POS add control without a redundant rail button", () => {
    const onAdd = vi.fn();
    render(<ProductCard product={baseProduct} mode="pos" onClick={onAdd} />);

    const add = screen.getByRole("button", { name: /agregar al carrito: camisa de lino natural/i });
    expect(add).toHaveClass("absolute", "inset-0");
    expect(screen.queryByRole("button", { name: /^\+ agregar$/i })).toBeNull();
  });
});

type CardProduct = ComponentProps<typeof ProductCard>["product"];

const promoProduct: CardProduct = {
  ...baseProduct,
  salePrice: 10000,
  effectiveSalePrice: 8000,
  promotionType: "PERCENTAGE",
  promotionValue: 20,
};

describe("ProductCard — premium card v2: shape and layers", () => {
  it("gives every card the same fixed 4:5 shape with a height guard", () => {
    const { container } = render(<ProductCard product={baseProduct} mode="inventory" />);

    // A fixed shape means content can never resize the card: a card stretched by its
    // grid row just shows more photo.
    expect(container.firstElementChild).toHaveClass(
      "relative",
      "isolate",
      "overflow-hidden",
      "rounded-2xl",
      "aspect-[4/5]",
      "min-h-[15.5rem]",
      "max-h-[22rem]",
    );
  });

  it.each([
    { label: "service", product: { ...baseProduct, type: "SERVICE", stock: 0 } },
    { label: "untracked", product: { ...baseProduct, tracksStock: false, stock: 0 } },
    { label: "depleted", product: { ...baseProduct, stock: 0, isLowStock: true } },
    { label: "low-stock", product: { ...baseProduct, stock: 3, isLowStock: true } },
    { label: "promotional", product: promoProduct },
    {
      label: "long-named",
      product: {
        ...baseProduct,
        name: "Camisa de lino natural con cuello mao y botones de coco tallados a mano",
        sku: "CAMISA-LINO-NATURAL-EXTRA-LARGA-SKU-000001",
      },
    },
  ] satisfies Array<{ label: string; product: CardProduct }>)(
    "renders a $label POS card with the exact root shape of a plain card",
    ({ product }) => {
      const plain = render(<ProductCard product={baseProduct} mode="pos" onClick={vi.fn()} />);
      const plainClassName = plain.container.firstElementChild?.className;
      plain.unmount();

      const { container } = render(<ProductCard product={product} mode="pos" onClick={vi.fn()} />);

      // The chip (or the name, or the promo) never changes the card shape.
      expect(container.firstElementChild).toHaveClass("aspect-[4/5]");
      expect(container.firstElementChild?.className).toBe(plainClassName);
    },
  );

  it.each(["pos", "inventory"] as const)("paints no backdrop filter anywhere in a %s card", (mode) => {
    const { container } = render(
      <ProductCard
        product={{ ...promoProduct, stock: 3, isLowStock: true }}
        mode={mode}
        onClick={vi.fn()}
        onDelete={vi.fn()}
        onToggleFavorite={vi.fn()}
        isFavorite
      />,
    );

    // backdrop-blur under overflow-hidden + rounded + a hover transform is what leaves a
    // grey wedge in the rounded corner, so no layer of the card may use one.
    const card = container.firstElementChild as HTMLElement;
    const nodes = [card, ...Array.from(card.querySelectorAll("*"))];
    expect(nodes.length).toBeGreaterThan(10);
    for (const node of nodes) {
      expect(node.getAttribute("class") ?? "").not.toMatch(/backdrop-/);
    }
  });

  it("paints a flat dark placeholder with a centered icon when there is no photo", () => {
    render(<ProductCard product={baseProduct} mode="pos" />);

    const media = screen.getByTestId("product-media");

    expect(media).toHaveClass("absolute", "inset-0", "rounded-[inherit]");
    expect(media.querySelector('[class*="bg-zinc-900"]')).not.toBeNull();
    expect(media.querySelector("svg")).not.toBeNull();
  });

  it.each(["pos", "inventory"] as const)("uses no gradient anywhere in the %s card", (mode) => {
    const { container } = render(<ProductCard product={promoProduct} mode={mode} onClick={vi.fn()} />);

    for (const node of [container.firstElementChild!, ...Array.from(container.querySelectorAll("*"))]) {
      expect(node.getAttribute("class") ?? "").not.toMatch(/(?:^|\s)(?:bg-gradient|from-|via-|to-)/);
    }
  });

  it("sets the info as a flat dark panel docked last, with no glass layer", () => {
    const { container } = render(<ProductCard product={promoProduct} mode="pos" onClick={vi.fn()} />);

    const card = container.firstElementChild;
    const sheet = screen.getByTestId("product-sheet");

    expect(card?.lastElementChild).toBe(sheet);
    expect(sheet).toHaveClass("relative", "mt-auto", "px-3", "pb-3", "pt-3", "bg-zinc-950/80");
    expect(sheet.className).not.toMatch(/backdrop-/);
    expect(Array.from(sheet.children).some((child) => child.classList.contains("absolute"))).toBe(false);
  });
});

describe("ProductCard — premium card v2: chips", () => {
  const chipCases: Array<{ label: string; product: CardProduct }> = [
    { label: "Activo", product: baseProduct },
    { label: "Inactivo", product: { ...baseProduct, active: false } },
    { label: "Agotado", product: { ...baseProduct, stock: 0, isLowStock: true } },
    { label: "Stock bajo", product: { ...baseProduct, stock: 3, isLowStock: true } },
    { label: "Servicio", product: { ...baseProduct, type: "SERVICE", stock: 0 } },
    { label: "Sin inventario", product: { ...baseProduct, tracksStock: false, stock: 0 } },
  ];

  it.each(chipCases)("renders the '$label' chip as a compact, photo-safe soft rectangle, never a pill", ({ label, product }) => {
    render(<ProductCard product={product} mode="inventory" />);

    const chip = screen.getByText(label);

    expect(chip).toHaveClass("rounded-md", "bg-white/90", "dark:bg-zinc-900/90");
    expect(chip).not.toHaveClass("rounded-full");
  });

  it("renders the offer badge as a compact, photo-safe soft rectangle, never a pill", () => {
    render(<ProductCard product={promoProduct} mode="inventory" />);

    const offer = screen.getByText(/Oferta/);

    expect(offer).toHaveClass("rounded-md", "bg-white/90", "dark:bg-zinc-900/90");
    expect(offer).not.toHaveClass("rounded-full");
  });

  it.each(["pos", "inventory"] as const)("renders the category as a tinted soft-rectangle chip in %s mode", (mode) => {
    render(<ProductCard product={baseProduct} mode={mode} />);

    const category = screen.getByText("Ropa");

    expect(category).toHaveClass("rounded-md", "font-mono", "max-w-full", "truncate", "border", "border-primary/50", "bg-primary/25", "text-orange-200");
    expect(category).not.toHaveClass("rounded-full");
  });

  it("falls back to 'General' for an uncategorized POS card", () => {
    render(<ProductCard product={{ ...baseProduct, category: null }} mode="pos" />);

    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.queryByText("Sin categoría")).toBeNull();
  });

  it("shows the healthy 'Activo' chip in inventory mode only", () => {
    const inventory = render(<ProductCard product={baseProduct} mode="inventory" />);
    expect(screen.getByText("Activo")).toBeInTheDocument();
    inventory.unmount();

    render(<ProductCard product={baseProduct} mode="pos" onClick={vi.fn()} />);
    expect(screen.queryByText("Activo")).toBeNull();
  });

  it.each([
    { label: "Inactivo", product: { ...baseProduct, active: false } },
    { label: "Agotado", product: { ...baseProduct, stock: 0, isLowStock: true } },
    { label: "Stock bajo", product: { ...baseProduct, stock: 3, isLowStock: true } },
    { label: "Sin inventario", product: { ...baseProduct, tracksStock: false, stock: 0 } },
  ] satisfies Array<{ label: string; product: CardProduct }>)("still shows the '$label' chip in POS mode", ({ label, product }) => {
    render(<ProductCard product={product} mode="pos" onClick={vi.fn()} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows a POS 'Servicio' chip as a click-through overlay and no stock element", () => {
    const { container } = render(
      <ProductCard product={{ ...baseProduct, type: "SERVICE", stock: 0 }} mode="pos" onClick={vi.fn()} />,
    );

    const card = container.firstElementChild as HTMLElement;
    const chip = screen.getByTestId("service-chip");
    const host = chip.parentElement === card ? chip : (chip.parentElement as HTMLElement);

    expect(chip.textContent?.trim()).toBe("Servicio");
    expect(host.parentElement).toBe(card);
    expect(host).toHaveClass("absolute", "pointer-events-none");
    expect(screen.queryByTestId("product-stock")).toBeNull();
    expect(screen.queryByText("0 uds.")).toBeNull();
  });
});

describe("ProductCard — premium card v2: content block", () => {
  it("sets the name, SKU and price in white over the scrim without truncating the price", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);

    const name = screen.getByRole("heading", { name: "Camisa de lino natural" });
    const sku = screen.getByText("SKU-0001");
    const price = screen.getByText("$ 45.000");

    expect(name).toHaveClass("line-clamp-2", "break-words", "text-sm", "font-semibold", "text-white");
    expect(sku).toHaveClass("min-w-0", "truncate", "font-mono", "text-white/60");
    expect(price).toHaveClass("font-mono", "text-[1.375rem]", "font-extrabold", "tabular-nums", "whitespace-nowrap", "text-white");
    expect(price).not.toHaveClass("truncate");
  });

  it("shows the stock of tracked goods on the SKU line, outside the price panel", () => {
    render(<ProductCard product={baseProduct} mode="inventory" />);

    const sku = screen.getByText("SKU-0001");
    const stock = screen.getByTestId("product-stock");

    expect(stock).toHaveTextContent("20 uds.");
    expect(stock).toHaveClass("shrink-0");
    expect(stock.parentElement).toBe(sku.parentElement);
    // SKU on the left, stock on the right.
    expect(sku.compareDocumentPosition(stock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("product-sheet")).toContainElement(stock);
    expect(screen.getByTestId("product-price-panel")).not.toContainElement(stock);
  });

  it.each([
    { label: "healthy", product: baseProduct, tone: /(?:^|\s)text-white\/85(?=\s|$)/ },
    { label: "low", product: { ...baseProduct, stock: 3, isLowStock: true }, tone: /(?:^|\s)text-amber-\d+(?=\s|$)/ },
    { label: "depleted", product: { ...baseProduct, stock: 0, isLowStock: true }, tone: /(?:^|\s)text-rose-\d+(?=\s|$)/ },
  ] satisfies Array<{ label: string; product: CardProduct; tone: RegExp }>)(
    "tones the stock count of a $label tracked good by its resolved status",
    ({ product, tone }) => {
      render(<ProductCard product={product} mode="inventory" />);

      expect(screen.getByTestId("product-stock").className).toMatch(tone);
    },
  );

  it("keeps the list price after the effective price and lets it wrap below on a narrow card", () => {
    render(<ProductCard product={promoProduct} mode="pos" />);

    const effective = screen.getByTestId("offer-effective-price");
    const list = screen.getByTestId("offer-list-price");

    expect(list.tagName).toBe("S");
    expect(list).toHaveClass("line-through", "text-white/60");
    expect(effective.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.parentElement).toBe(effective.parentElement);
    expect(effective.parentElement).toHaveClass("flex", "flex-wrap", "items-baseline");
    expect(effective).not.toHaveClass("truncate");
  });
});

describe("ProductCard — premium card v2: control rail", () => {
  it("reveals the inventory deactivate control on hover-capable devices and keeps it visible on touch", () => {
    render(<ProductCard product={baseProduct} mode="inventory" onClick={vi.fn()} onDelete={vi.fn()} />);

    const deactivate = screen.getByRole("button", { name: /desactivar producto/i });
    const rail = deactivate.parentElement as HTMLElement;

    expect(rail).toHaveClass(
      "absolute",
      "right-1.5",
      "top-1.5",
      "z-20",
      "flex-col",
      "transition-opacity",
      "[@media(hover:hover)]:opacity-0",
      "[@media(hover:hover)]:group-hover:opacity-100",
      "focus-within:opacity-100",
    );
    // 44px hit area around a small, flat, quiet disc.
    expect(deactivate).toHaveClass("h-11", "w-11");
    expect(deactivate.firstElementChild).toHaveClass("h-7", "w-7", "bg-black/40", "border-white/20", "text-white");
  });

  it("renders no rail at all in inventory when there is no deactivate or reactivate handler", () => {
    render(<ProductCard product={baseProduct} mode="inventory" onClick={vi.fn()} />);

    // Only the full-card edit button remains.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /desactivar producto|reactivar producto/i })).toBeNull();
  });

  it("keeps the POS favorite control always visible in one quiet rail without a redundant add button", () => {
    render(<ProductCard product={baseProduct} mode="pos" onClick={vi.fn()} onToggleFavorite={vi.fn()} />);

    const favorite = screen.getByRole("button", { name: /agregar a favoritos/i });

    expect(screen.queryByRole("button", { name: /^\+ agregar$/i })).toBeNull();
    expect(favorite.parentElement?.className).not.toMatch(/opacity-0/);
    expect(favorite).toHaveClass("h-11", "w-11");
    expect(favorite.firstElementChild).toHaveClass("h-7", "w-7");
  });
});
