import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategoryProductsModal, categoryPageCapacity } from "./CategoryProductsModal";
import type { Category, Product } from "@/types";

const query = vi.fn();
vi.mock("@/hooks/useProducts", () => ({ useProducts: (params: unknown) => query(params) }));
const category = { id: "a", name: "Alimentos" } as Category;
function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p-1", name: "Arroz Diana", sku: "ARR-1", barcode: null, description: null,
    costPrice: 3000, salePrice: 4500, taxRate: 0, stock: 20, minStock: 5,
    isLowStock: false, imageUrl: null, categoryId: "cat-1", active: true,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1, ...overrides,
  };
}

function setProducts(products: Product[]) {
  query.mockReturnValue({
    data: { data: products, meta: { total: products.length, page: 1, limit: 200, totalPages: 1 } },
    isLoading: false, isError: false,
  });
}

/** The badge colours are the only visible signal, so assert on the class, not the text. */
const badgeClasses = (productName: string) => {
  const row = screen.getByText(productName).closest("li")!;
  return Array.from(row.querySelectorAll("span")).map(node => node.className).join(" ");
};

const product = { id: "p", name: "Café de nombre largo sin truncar", sku: "SKU-LARGO", stock: 2, isLowStock: true, salePrice: 12500, active: true };
let total = 39;

beforeEach(() => {
  total = 39;
  vi.clearAllMocks();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  query.mockImplementation((params) => ({ data: { data: [{ ...product, id: `${params.page}`, name: `Producto página ${params.page}` }], meta: { total } }, isLoading: false, isError: false, isPlaceholderData: false }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("CategoryProductsModal server paging", () => {
  it("requests bounded server pages and exposes accurate totals and navigation", async () => {
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    const request = query.mock.lastCall![0];
    expect(request).toMatchObject({ categoryId: "a", page: 1, status: "all" });
    expect(request.limit).toBeGreaterThan(0);
    expect(request.limit).toBeLessThan(200);
    expect(screen.getByText(/39 productos/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Página anterior" }).hasAttribute("disabled")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(query.mock.lastCall![0].page).toBe(2);
    expect(screen.getByText("Producto página 2")).toBeTruthy();
    expect(screen.getByText(new RegExp(`Mostrando ${request.limit + 1}–${request.limit + 1} de 39`))).toBeTruthy();
  });

  it("reaches the final server page beyond 200 products and disables forward navigation", async () => {
    total = 203;
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    const limit = query.mock.lastCall![0].limit;
    const pages = Math.ceil(total / limit);
    for (let page = 1; page < pages; page++) {
      await userEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    }
    expect(query.mock.lastCall![0].page).toBe(pages);
    expect(screen.getByText(`Página ${pages} de ${pages}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Página siguiente" }).hasAttribute("disabled")).toBe(true);
  });

  it("resets on category, close/reopen and viewport capacity changes", async () => {
    const view = render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    const next = () => userEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    await next();
    view.rerender(<CategoryProductsModal category={{ ...category, id: "b" }} onClose={vi.fn()} />);
    expect(query.mock.lastCall![0]).toMatchObject({ categoryId: "b", page: 1 });
    await next();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    fireEvent(window, new Event("resize"));
    expect(query.mock.lastCall![0].page).toBe(1);
    await next();
    view.rerender(<CategoryProductsModal category={null} onClose={vi.fn()} />);
    view.rerender(<CategoryProductsModal category={{ ...category, id: "b" }} onClose={vi.fn()} />);
    expect(query.mock.lastCall![0].page).toBe(1);
  });

  it("clamps when the server total shrinks", async () => {
    const view = render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    total = 1;
    view.rerender(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(query.mock.lastCall![0].page).toBe(1);
    expect(screen.getByRole("button", { name: "Página siguiente" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("1 producto")).toBeTruthy();
  });

  it("does not expose placeholder rows or counts from a previous request", () => {
    query.mockReturnValue({ data: { data: [product], meta: { total: 99 } }, isPlaceholderData: true, isLoading: false });
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(screen.queryByText(product.name)).toBeNull();
    expect(screen.queryByText(/99 productos/)).toBeNull();
    expect(screen.getByText("Cargando productos...")).toBeTruthy();
  });

  it("preserves server price and stock and uses an untruncated responsive grid without scroll instructions", () => {
    query.mockReturnValue({ data: { data: [product], meta: { total: 1 } } });
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(screen.getByText(product.name).className).not.toContain("truncate");
    expect(screen.getByText("2 uds.")).toBeTruthy();
    expect(screen.getByText(/12.500/)).toBeTruthy();
    const list = screen.getByRole("list");
    expect(list.className).toContain("grid");
    expect(list.className).not.toMatch(/overflow|max-h/);
    expect(screen.queryByText(/Desplázate/)).toBeNull();
  });

  it("preserves service and inactive badges without inventing service stock", () => {
    query.mockReturnValue({ data: { data: [{ ...product, type: "SERVICE", active: false, stock: 0 }], meta: { total: 1 } } });
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(screen.getByText("Servicio")).toBeTruthy();
    expect(screen.getByText(/Inactivo/)).toBeTruthy();
    expect(screen.queryByText("0 uds.")).toBeNull();
  });

  it.each([
    [{ isLoading: true }, "Cargando productos..."],
    [{ isError: true }, "No se pudieron cargar los productos"],
    [{ data: { data: [], meta: { total: 0 } } }, "No hay productos en esta categoría"],
  ])("keeps loading/error/empty behavior", (response, text) => {
    query.mockReturnValue(response);
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("measures wrapped cards and chrome, resets capacity, and disconnects its observer", async () => {
    let notify: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notify = callback; }
      observe() {}
      disconnect() { disconnect(); }
    });
    let rowHeight = 116;
    let headerHeight = 64;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const height = this.tagName === "LI" ? rowHeight : this.querySelector("h2") ? headerHeight : this.tagName === "NAV" ? 64 : 28;
      return { width: 700, height, top: 0, bottom: height, left: 0, right: 700, x: 0, y: 0, toJSON() {} };
    });
    const view = render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    const initialLimit = query.mock.lastCall![0].limit;
    await userEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    rowHeight = 230;
    headerHeight = 100;
    act(() => notify());
    expect(query.mock.lastCall![0].limit).toBeLessThan(initialLimit);
    expect(query.mock.lastCall![0].page).toBe(1);
    const smallerLimit = query.mock.lastCall![0].limit;
    rowHeight = 116;
    headerHeight = 64;
    act(() => notify());
    expect(query.mock.lastCall![0].limit).toBe(smallerLimit);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("uses a reserved grid budget and gaps and reduces capacity for wrapped rows (not browser proof)", () => {
    expect(categoryPageCapacity(600, 700, 116)).toBe(8);
    expect(categoryPageCapacity(600, 320, 116)).toBe(4);
    expect(categoryPageCapacity(300, 700, 180)).toBe(2);
    expect(categoryPageCapacity(80, 320, 116)).toBe(1);
  });
});

// Retain the pre-existing server-stock regressions alongside pagination coverage.
describe("CategoryProductsModal stock badge — server low-stock flag", () => {
  it("badges a healthy product as neither low nor out of stock", () => {
    setProducts([buildProduct({ stock: 20, minStock: 5, isLowStock: false })]);
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(screen.getByText("20 uds.")).toBeInTheDocument();
    expect(badgeClasses("Arroz Diana")).toContain("bg-success/10");
  });

  it("badges a tracked product at or below minStock as low, using the server flag", () => {
    setProducts([buildProduct({ stock: 3, minStock: 5, isLowStock: true })]);
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(badgeClasses("Arroz Diana")).toContain("bg-warning/10");
  });

  it("does NOT badge an untracked product as low on stock (the regression this fixes)", () => {
    setProducts([buildProduct({ id: "p-2", name: "Papel sin conteo", type: "PRODUCT", tracksStock: false, stock: 2, minStock: 5, isLowStock: false })]);
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(screen.getByText("Papel sin conteo")).toBeInTheDocument();
    expect(badgeClasses("Papel sin conteo")).toContain("bg-success/10");
    expect(badgeClasses("Papel sin conteo")).not.toContain("bg-warning/10");
  });

  it("does NOT badge a service as low on stock whatever its numbers say", () => {
    setProducts([buildProduct({ id: "p-3", name: "Mantenimiento", type: "SERVICE", tracksStock: false, stock: 0, minStock: 5, isLowStock: false })]);
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(screen.getByText("Servicio")).toBeInTheDocument();
    expect(badgeClasses("Mantenimiento")).not.toContain("bg-warning/10");
  });

  it("badges a depleted tracked product as out of stock, ahead of the low flag", () => {
    setProducts([buildProduct({ stock: 0, minStock: 5, isLowStock: true })]);
    render(<CategoryProductsModal category={category} onClose={vi.fn()} />);
    expect(badgeClasses("Arroz Diana")).toContain("bg-danger/10");
    expect(badgeClasses("Arroz Diana")).not.toContain("bg-warning/10");
  });
});
