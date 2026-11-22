import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Product, Supplier } from "@/types";

const { routerPush, createMutateAsync } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  createMutateAsync: vi.fn(),
}));

const suppliers: Supplier[] = [
  {
    id: "supplier-1",
    name: "Proveedor Andino",
    documentNumber: "900123456",
    active: true,
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
  },
  {
    id: "supplier-2",
    name: "Distribuidora Sur",
    documentNumber: "900654321",
    active: true,
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
  },
];

function makeProduct(overrides: Partial<Product> & Pick<Product, "id" | "name" | "sku">): Product {
  return {
    barcode: null,
    description: null,
    costPrice: 100,
    salePrice: 150,
    taxRate: 19,
    stock: 10,
    minStock: 1,
    imageUrl: null,
    categoryId: "cat-1",
    active: true,
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

const products: Product[] = [
  makeProduct({ id: "prod-1", name: "Producto Uno", sku: "SKU-1" }),
  // Services arrive without a catalog cost: the order row has to ask for one.
  makeProduct({ id: "prod-2", name: "Producto Dos", sku: "SKU-2", costPrice: 0, taxRate: 0 }),
];

// The catalog list is swapped per test: `costPrice` is a Prisma `Decimal`, so the
// real response can hand a price over as a string.
const productList = { items: products };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: () => ({ data: { data: suppliers }, isLoading: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    data: {
      data: productList.items,
      meta: { total: productList.items.length, page: 1, limit: 25, totalPages: 1 },
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/usePurchaseOrders", () => ({
  useCreatePurchaseOrder: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import NewPurchaseOrderPage from "./page";

function searchField() {
  return screen.getByRole("combobox", { name: /buscar producto/i });
}

async function addProduct(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(searchField());
  await user.click(screen.getByRole("option", { name }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  productList.items = products;
});

describe("New purchase order — picking products", () => {
  it("searches, adds the product, and focuses the new row's quantity", async () => {
    const user = userEvent.setup();
    render(<NewPurchaseOrderPage />);

    await user.type(searchField(), "dos");
    await user.click(screen.getByRole("option", { name: /Producto Dos/i }));

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Producto Dos")).toBeTruthy();

    const qty = table.getByLabelText("Cantidad de Producto Dos") as HTMLInputElement;
    expect(document.activeElement).toBe(qty);

    // The results popover closes with the pick.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("walks the results with the arrow keys and adds the highlighted one with Enter", async () => {
    const user = userEvent.setup();
    render(<NewPurchaseOrderPage />);

    await user.click(searchField());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(within(screen.getByRole("table")).getByText("Producto Dos")).toBeTruthy();
  });

  it("closes the results with Escape and clears the term with a second Escape", async () => {
    const user = userEvent.setup();
    render(<NewPurchaseOrderPage />);

    await user.type(searchField(), "uno");
    expect(screen.getByRole("listbox")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(searchField()).toHaveValue("uno");

    await user.keyboard("{Escape}");
    expect(searchField()).toHaveValue("");
  });

  it("marks a product already in the order instead of offering it twice", async () => {
    const user = userEvent.setup();
    render(<NewPurchaseOrderPage />);

    await addProduct(user, /Producto Uno/i);
    await user.click(searchField());

    const option = screen.getByRole("option", { name: /Producto Uno/i });
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(within(option).getByText("Agregado")).toBeTruthy();
  });

  it("shows the empty state inside the card before anything is added", () => {
    render(<NewPurchaseOrderPage />);

    expect(screen.getByText("Busca un producto para agregarlo")).toBeTruthy();
  });
});

describe("New purchase order — a row without a cost blocks the draft", () => {
  it("flags the row and lists the reason in the summary", async () => {
    const user = userEvent.setup();
    render(<NewPurchaseOrderPage />);

    await addProduct(user, /Producto Dos/i);

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Falta el costo")).toBeTruthy();
    expect(table.getByLabelText("Costo unitario de Producto Dos")).toHaveClass("border-warning/70");

    expect(screen.getByText("Completa el costo de 1 producto")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
  });

  it("does not flag a cost that arrives as a decimal string", async () => {
    // Prisma `Decimal` columns serialize as "12535.00": a price, not a gap.
    productList.items = [
      makeProduct({
        id: "prod-9",
        name: "Producto Decimal",
        sku: "SKU-9",
        costPrice: "12535.00" as unknown as number,
      }),
    ];
    const user = userEvent.setup();
    render(<NewPurchaseOrderPage />);

    await addProduct(user, /Producto Decimal/i);

    expect(screen.queryByText("Falta el costo")).toBeNull();
    const table = within(screen.getByRole("table"));
    expect(table.getByLabelText("Costo unitario de Producto Decimal")).not.toHaveClass(
      "border-warning/70",
    );
    expect(table.getAllByText("$ 12.535").length).toBeGreaterThan(0);
  });

  it("clears the flag once the cost is typed", async () => {
    const user = userEvent.setup();
    render(<NewPurchaseOrderPage />);

    await addProduct(user, /Producto Dos/i);
    const cost = within(screen.getByRole("table")).getByLabelText(
      "Costo unitario de Producto Dos",
    ) as HTMLInputElement;
    await user.type(cost, "5000");

    expect(screen.queryByText("Falta el costo")).toBeNull();
    expect(cost.value).toBe("5.000");
    expect(cost).not.toHaveClass("border-warning/70");
  });
});

describe("New purchase order — supplier and summary", () => {
  it("lists the missing supplier as the reason the draft cannot be saved", () => {
    render(<NewPurchaseOrderPage />);

    expect(screen.getByText("Selecciona un proveedor")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
  });

  it("names the chosen supplier and the item count, and enables the draft", async () => {
    const user = userEvent.setup();
    render(<NewPurchaseOrderPage />);

    await user.click(screen.getByRole("button", { name: /proveedor/i }));
    await user.click(screen.getByRole("option", { name: /Proveedor Andino/ }));
    await addProduct(user, /Producto Uno/i);

    expect(screen.getByText("Proveedor Andino")).toBeTruthy();
    expect(screen.getByText("1 producto")).toBeTruthy();
    expect(screen.getByText("1 unidad")).toBeTruthy();
    expect(screen.queryByText("Selecciona un proveedor")).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeEnabled();
  });

  it("places the product editor ahead of optional notes and keeps the untouched summary calm", () => {
    const { container } = render(<NewPurchaseOrderPage />);

    const editor = screen.getByTestId("purchase-order-item-editor");
    const notes = screen.getByLabelText("Notas u observaciones (opcional)");
    expect(
      editor.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Untouched form shows muted setup hints without an amber warning box.
    expect(screen.getByText("Selecciona un proveedor")).toBeTruthy();
    expect(screen.getByText("Agrega al menos un producto")).toBeTruthy();
    expect(container.querySelector(".bg-warning\\/10")).toBeNull();
  });
});
