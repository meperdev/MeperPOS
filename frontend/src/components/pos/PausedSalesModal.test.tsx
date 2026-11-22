import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { PausedSale } from "@/hooks/usePausedSales";
import type { Product } from "@/types";

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    title,
    size,
    footer,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    size?: string;
    footer?: ReactNode;
    children: ReactNode;
  }) =>
    isOpen ? (
      <section role="dialog" aria-label={title} data-size={size}>
        <h2>{title}</h2>
        {children}
        {footer}
      </section>
    ) : null,
}));

import { PausedSalesModal } from "./PausedSalesModal";

function makeProduct(id: string, name: string, salePrice = 10000): Product {
  return {
    id,
    name,
    sku: `SKU-${id}`,
    barcode: null,
    description: null,
    costPrice: 5000,
    salePrice,
    taxRate: 0,
    stock: 20,
    minStock: 2,
    imageUrl: null,
    categoryId: "cat-1",
    active: true,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    organizationId: "org-1",
    version: 1,
  };
}

function makePausedSale(overrides: Partial<PausedSale> = {}): PausedSale {
  return {
    id: "pause-1",
    customerId: "",
    discountAmount: 0,
    pausedAt: "2026-11-21T21:41:54.000Z",
    cart: [
      {
        productId: "p1",
        product: makeProduct("p1", "Cargador USB-C", 35000),
        quantity: 2,
        unitPrice: 35000,
        originalUnitPrice: 35000,
        availableStock: 20,
        discountAmount: 0,
      },
      {
        productId: "p2",
        product: makeProduct("p2", "Audífonos básicos", 20000),
        quantity: 1,
        unitPrice: 20000,
        originalUnitPrice: 20000,
        availableStock: 20,
        discountAmount: 0,
      },
      {
        productId: "p3",
        product: makeProduct("p3", "Marcador permanente", 5000),
        quantity: 1,
        unitPrice: 5000,
        originalUnitPrice: 5000,
        availableStock: 20,
        discountAmount: 0,
      },
    ],
    ...overrides,
  };
}

describe("PausedSalesModal", () => {
  afterEach(cleanup);

  it("renders a proportionate md modal with hairline rows, item preview, proportional date, and net total", () => {
    render(
      <PausedSalesModal
        isOpen
        onClose={vi.fn()}
        pausedSales={[makePausedSale({ discountAmount: 5000 })]}
        onResume={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Ventas pausadas" });
    expect(dialog).toHaveAttribute("data-size", "md");

    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Sin cliente")).toBeInTheDocument();
    expect(
      within(row).getByText("Cargador USB-C ×2, Audífonos básicos ×1 +1 más"),
    ).toBeInTheDocument();
    expect(within(row).getByText("3 productos (4 und.)")).toBeInTheDocument();

    // Proportional date: no tabular-nums on the date span.
    const dateSpan = within(row).getByText(/nov 2026/i);
    expect(dateSpan.className).not.toContain("tabular-nums");

    // 2*35000 + 20000 + 5000 - 5000 global discount = 90000
    expect(within(row).getByText(/\$\s*90\.000/)).toBeInTheDocument();

    // Compact action instead of full-width orange slab.
    const resumeBtn = within(row).getByRole("button", { name: "Reanudar" });
    expect(resumeBtn.className).not.toContain("flex-1");
    expect(screen.getByText("1 venta pausada")).toBeInTheDocument();
  });

  it("triggers onResume and two-step onDelete", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    const onDelete = vi.fn();

    render(
      <PausedSalesModal
        isOpen
        onClose={vi.fn()}
        pausedSales={[makePausedSale({ id: "pause-9", customerName: "Ana Pérez" })]}
        onResume={onResume}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reanudar" }));
    expect(onResume).toHaveBeenCalledWith("pause-9");

    await user.click(
      screen.getByRole("button", { name: "Eliminar venta pausada de Ana Pérez" }),
    );
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "¿Eliminar?" }));
    expect(onDelete).toHaveBeenCalledWith("pause-9");
  });

  it("renders EmptyState when there are no paused sales", () => {
    render(
      <PausedSalesModal
        isOpen
        onClose={vi.fn()}
        pausedSales={[]}
        onResume={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("No hay ventas pausadas")).toBeInTheDocument();
    expect(screen.queryByText(/venta pausada/i)).toBeNull();
  });
});
