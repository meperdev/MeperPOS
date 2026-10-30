import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, useEffect, type ComponentProps, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

const create = vi.fn().mockResolvedValue({});
const update = vi.fn().mockResolvedValue({});
const uploadImage = vi.fn().mockResolvedValue({ imageUrl: "/images/panela-new.jpg" });
const uploadImageById = vi.fn().mockResolvedValue({ imageUrl: "/images/panela-new.jpg" });
let role = "ADMIN";
let products: ReturnType<typeof product>[] = [];

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ data: { data: products, meta: { total: products.length, totalPages: 1 } }, isLoading: false, isFetching: false }),
  useCreateProduct: () => ({ mutateAsync: create, isPending: false }),
  useUpdateProduct: () => ({ mutateAsync: update, isPending: false }),
  useDeactivateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactivateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadProductImage: () => ({ mutateAsync: uploadImage, isPending: false }),
  useUploadProductImageById: () => ({ mutateAsync: uploadImageById, isPending: false }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: { data: [{ id: "cat-1", name: "General" }] } }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/ui/Modal", () => ({
  Modal: function MockModal({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: ReactNode }) {
    useEffect(() => {
      if (!isOpen) return;
      const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [isOpen, onClose]);
    return isOpen ? <div role="dialog" aria-label={title}>
      <button type="button" aria-label="Backdrop" onClick={onClose} />
      <button type="button" aria-label="Cerrar" onClick={onClose} />
      {children}
    </div> : null;
  },
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/products/ProductCard", () => ({
  ProductCard: function ProductCard({ product: item, onClick }: { product: ReturnType<typeof product>; onClick?: () => void }) {
    return <button onClick={onClick} data-image-url={item.imageUrl ?? ""}>{item.name}</button>;
  },
}));
vi.mock("@/components/ui/ImageUpload", async (importOriginal) => {
  const { ImageUpload: RealImageUpload } = await importOriginal<typeof import("@/components/ui/ImageUpload")>();
  return {
    ImageUpload: (props: ComponentProps<typeof RealImageUpload>) => (
      <div data-testid="product-image"><RealImageUpload {...props} /></div>
    ),
  };
});
vi.mock("@/components/ui/Input", () => ({
  Input: forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; textarea?: boolean }>(
    function MockInput({ label, textarea, ...props }, ref) {
      return textarea
        ? <textarea aria-label={label} {...(props as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
        : <input ref={ref} aria-label={label} {...props} />;
    },
  ),
}));
vi.mock("@/components/ui/CurrencyInput", () => ({
  CurrencyInput: ({ label, value, onChange, placeholder }: {
    label?: string; value?: number | string; onChange: (value: number) => void; placeholder?: string;
  }) => <input aria-label={label || placeholder} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} />,
}));
vi.mock("@/components/ui/BentoSelect", () => ({
  BentoSelect: ({ label, placeholder, value, options, onChange }: {
    label?: string; placeholder?: string; value?: string;
    options: { value: string; label: string }[]; onChange: (value: string) => void;
  }) => <select aria-label={label || placeholder} value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));

import InventoryPage from "./page";

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1", name: "Panela", sku: "PAN-1", barcode: "123456", description: "Dulce",
    type: "PRODUCT", costPrice: 1000, salePrice: 2000, taxRate: 19,
    stock: 8, minStock: 2, isLowStock: false, categoryId: "cat-1", imageUrl: null,
    promotionType: null, promotionValue: null, active: true, version: 1,
    ...overrides,
  };
}

const openCreate = () => {
  fireEvent.click(screen.getByRole("button", { name: "Nuevo Producto" }));
  return screen.getByRole("dialog", { name: "Nuevo Producto" });
};
const openEdit = () => {
  fireEvent.click(screen.getByRole("button", { name: "Panela" }));
  return screen.getByRole("dialog", { name: "Editar Producto" });
};
const selectImage = (dialog: HTMLElement) => {
  const fileInput = within(dialog).getByTestId("product-image").querySelector<HTMLInputElement>('input[type="file"]');
  expect(fileInput).not.toBeNull();
  const file = new File(["new photo"], "panela.png", { type: "image/png" });
  fireEvent.change(fileInput!, { target: { files: [file] } });
  return file;
};

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:panela-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.clearAllMocks();
  create.mockResolvedValue({});
  update.mockResolvedValue({});
  uploadImage.mockResolvedValue({ imageUrl: "/images/panela-new.jpg" });
  uploadImageById.mockResolvedValue({ imageUrl: "/images/panela-new.jpg" });
  role = "ADMIN";
  products = [];
});
afterEach(cleanup);

describe("inventory product modal", () => {
  it("opens a blank create form, keeps core fields, and cancels without saving", () => {
    render(<InventoryPage />);
    const dialog = openCreate();
    expect(within(dialog).getByLabelText("Nombre")).toHaveValue("");
    expect(within(dialog).getByLabelText("SKU")).toHaveValue("");
    expect(within(dialog).getByLabelText("Código de Barras")).toHaveValue("");
    expect(within(dialog).getByLabelText("Categoría")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Precio de Costo")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Precio de Venta")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Impuesto (%)")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Descripción")).toBeInTheDocument();
    expect(within(dialog).getByTestId("product-image")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("preloads edit values and updates the existing product without read-only metadata", async () => {
    products = [
      product({
        // Fields the API returns but the update DTO does not accept. Sending
        // any of them fails the whitelisted validation and blocks editing.
        reservedStock: 2,
        availableStock: 6,
        organizationId: "org-1",
        effectiveSalePrice: 1800,
        preferredSupplierId: "sup-1",
      }),
    ];
    render(<InventoryPage />);
    const dialog = openEdit();
    expect(within(dialog).getByLabelText("Nombre")).toHaveValue("Panela");
    expect(within(dialog).getByLabelText("SKU")).toHaveValue("PAN-1");
    expect(within(dialog).getByLabelText("Impuesto (%)")).toHaveValue(19);
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Panela orgánica" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      id: "p-1",
      data: expect.objectContaining({ name: "Panela orgánica", type: "PRODUCT", tracksStock: true, stock: 8, minStock: 2 }),
    }));
    const payload = update.mock.calls[0][0].data as Record<string, unknown>;
    for (const field of [
      "id",
      "version",
      "organizationId",
      "reservedStock",
      "availableStock",
      "effectiveSalePrice",
      "effectiveTaxRate",
      "isLowStock",
      "preferredSupplierId",
      "createdAt",
      "updatedAt",
    ]) {
      expect(payload, field).not.toHaveProperty(field);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("stages an edit image without uploading or updating until Save, then uses the generic upload and update payload", async () => {
    products = [product({ imageUrl: "/images/panela-original.jpg" })];
    render(<InventoryPage />);
    const dialog = openEdit();
    const file = selectImage(dialog);

    expect(uploadImageById).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("img", { name: "Preview" })).toHaveAttribute("src", "blob:panela-preview");
    expect(screen.getByRole("button", { name: "Panela" })).toHaveAttribute("data-image-url", "/images/panela-original.jpg");

    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      id: "p-1",
      data: expect.objectContaining({ imageUrl: "/images/panela-new.jpg" }),
    }));
    expect(uploadImage).toHaveBeenCalledWith(file);
    expect(uploadImageById).not.toHaveBeenCalled();
  });

  it("locks the edited product until its pending image upload and update finish", async () => {
    products = [
      product({ imageUrl: "/images/panela-original.jpg" }),
      product({ id: "p-2", name: "Leche", sku: "LEC-1", imageUrl: "/images/leche.jpg" }),
    ];
    let resolveUpload!: (result: { imageUrl: string }) => void;
    let resolveUpdate!: (result: object) => void;
    uploadImage.mockImplementationOnce(() => new Promise((resolve) => { resolveUpload = resolve; }));
    update.mockImplementationOnce(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    render(<InventoryPage />);
    const dialog = openEdit();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Panela orgánica" } });
    const file = selectImage(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(uploadImage).toHaveBeenCalledWith(file));
    expect(update).not.toHaveBeenCalled();

    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Backdrop" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Leche" }));
    fireEvent.click(screen.getByRole("button", { name: "Nuevo Producto" }));
    fireEvent.submit(within(dialog).getByRole("button", { name: "Actualizar" }).closest("form")!);
    expect(uploadImage).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Editar Producto" })).toBe(dialog);
    expect(within(dialog).getByLabelText("Nombre")).toHaveValue("Panela orgánica");
    const name = within(dialog).getByLabelText("Nombre");
    expect(name).toBeDisabled();
    fireEvent.change(name, { target: { value: "Otro producto" } });
    expect(update).not.toHaveBeenCalled();

    await act(async () => { resolveUpload({ imageUrl: "/images/panela-new.jpg" }); });
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith({
      id: "p-1",
      data: expect.objectContaining({ name: "Panela orgánica", imageUrl: "/images/panela-new.jpg" }),
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Backdrop" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Leche" }));
    fireEvent.submit(within(dialog).getByRole("button", { name: "Actualizar" }).closest("form")!);
    expect(update).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Editar Producto" })).toBe(dialog);
    expect(uploadImageById).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Leche" })).toHaveAttribute("data-image-url", "/images/leche.jpg");
    await act(async () => { resolveUpdate({}); });
    expect(screen.queryByRole("dialog", { name: "Editar Producto" })).not.toBeInTheDocument();
  });

  it("discards a selected edit image on Cancel and restores the existing preview on reopen", () => {
    products = [product({ imageUrl: "/images/panela-original.jpg" })];
    render(<InventoryPage />);
    const dialog = openEdit();
    selectImage(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Panela" })).toHaveAttribute("data-image-url", "/images/panela-original.jpg");
    expect(update).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
    expect(uploadImageById).not.toHaveBeenCalled();

    const reopened = openEdit();
    expect(within(reopened).getByRole("img", { name: "Preview" })).toHaveAttribute("src", expect.stringContaining("panela-original.jpg"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:panela-preview");
  });

  it("saves removal of an existing image as an explicit empty value only after Save", async () => {
    products = [product({ imageUrl: "/images/panela-original.jpg" })];
    render(<InventoryPage />);
    const dialog = openEdit();
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    expect(within(dialog).queryByRole("img", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Panela" })).toHaveAttribute("data-image-url", "/images/panela-original.jpg");
    expect(update).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
    expect(uploadImageById).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0].data).toHaveProperty("imageUrl");
    expect(update.mock.calls[0][0].data.imageUrl).toBe("");
    expect(uploadImage).not.toHaveBeenCalled();
    expect(uploadImageById).not.toHaveBeenCalled();
  });

  it("removes a pending replacement without uploading it and clears the saved image on Save", async () => {
    products = [product({ imageUrl: "/images/panela-original.jpg" })];
    render(<InventoryPage />);
    const dialog = openEdit();
    selectImage(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    expect(within(dialog).queryByRole("img", { name: "Preview" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0].data.imageUrl).toBe("");
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("uploads a new product image only after valid Save, then sends its URL", async () => {
    render(<InventoryPage />);
    const dialog = openCreate();
    const file = selectImage(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear" }));
    expect(uploadImage).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Café" } });
    fireEvent.change(within(dialog).getByLabelText("SKU"), { target: { value: "CAF-1" } });
    fireEvent.change(within(dialog).getByLabelText("Categoría"), { target: { value: "cat-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(uploadImage).toHaveBeenCalledWith(file);
    expect(create.mock.calls[0][0].imageUrl).toBe("/images/panela-new.jpg");
    expect(create.mock.calls[0][0].imageUrl).not.toMatch(/^data:/);
  });

  it("keeps the uploaded URL in the draft after update failure and retries without uploading again", async () => {
    products = [product({ imageUrl: "/images/panela-original.jpg" })];
    let rejectUpdate!: (reason: Error) => void;
    update.mockImplementationOnce(() => new Promise((_, reject) => { rejectUpdate = reject; }));
    render(<InventoryPage />);
    const dialog = openEdit();
    selectImage(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Backdrop" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Actualizar" }).closest("form")!);
    expect(update).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Editar Producto" })).toBe(dialog);
    await act(async () => { rejectUpdate(new Error("Save failed")); });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled());
    expect(within(dialog).getByRole("img", { name: "Preview" })).toHaveAttribute("src", expect.stringContaining("panela-new.jpg"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[1][0].data.imageUrl).toBe("/images/panela-new.jpg");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar Producto" })).not.toBeInTheDocument());
  });

  it("defaults new products to tracked inventory with stock inputs", () => {
    render(<InventoryPage />);
    const dialog = openCreate();
    expect(within(dialog).getByLabelText("Tipo")).toHaveValue("PRODUCT");
    const inventory = within(dialog).getByRole("group", { name: /inventario/i });
    expect(within(inventory).getByRole("checkbox", { name: /stock|inventario/i })).toBeChecked();
    expect(within(inventory).getByLabelText("Stock")).toBeInTheDocument();
    expect(within(inventory).getByLabelText("Stock Mín.")).toBeInTheDocument();
  });

  it("creates an untracked product with zero stock while retaining its product type", async () => {
    render(<InventoryPage />);
    const dialog = openCreate();
    const inventory = within(dialog).getByRole("group", { name: /inventario/i });
    fireEvent.click(within(inventory).getByRole("checkbox", { name: /stock|inventario/i }));
    expect(within(inventory).getByRole("checkbox", { name: /stock|inventario/i })).not.toBeChecked();
    expect(within(inventory).queryByLabelText("Stock")).not.toBeInTheDocument();
    expect(within(inventory).queryByLabelText("Stock Mín.")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tipo")).toHaveValue("PRODUCT");
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Tarjeta regalo" } });
    fireEvent.change(within(dialog).getByLabelText("SKU"), { target: { value: "TAR-1" } });
    fireEvent.change(within(dialog).getByLabelText("Categoría"), { target: { value: "cat-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Tarjeta regalo", type: "PRODUCT", tracksStock: false, stock: 0, minStock: 0,
    })));
  });

  it("keeps an existing untracked product unchecked and unchanged on update", async () => {
    products = [product({ tracksStock: false, stock: 0, minStock: 0 })];
    render(<InventoryPage />);
    const dialog = openEdit();
    const inventory = within(dialog).getByRole("group", { name: /inventario/i });
    expect(within(dialog).getByLabelText("Tipo")).toHaveValue("PRODUCT");
    expect(within(inventory).getByRole("checkbox", { name: /stock|inventario/i })).not.toBeChecked();
    expect(within(inventory).queryByLabelText("Stock")).not.toBeInTheDocument();
    expect(within(inventory).queryByLabelText("Stock Mín.")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      id: "p-1",
      data: expect.objectContaining({ type: "PRODUCT", tracksStock: false, stock: 0, minStock: 0 }),
    }));
  });

  it("excludes untracked products from the low-stock list", () => {
    products = [
      product({ tracksStock: false, stock: 0, minStock: 2, isLowStock: false }),
      product({ id: "p-2", name: "Leche", tracksStock: true, stock: 0, minStock: 2, isLowStock: true }),
    ];
    render(<InventoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /stock bajo/i }));
    expect(screen.queryByRole("button", { name: "Panela" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leche" })).toBeInTheDocument();
  });

  it("reads the server low-stock flag instead of the raw numbers", () => {
    // A tracked product above min stock that the server nevertheless flags (it moved
    // between pages) must show, and one below min stock the server cleared must not.
    products = [
      product({ id: "p-3", name: "Arroz", stock: 50, minStock: 2, isLowStock: true }),
      product({ id: "p-4", name: "Azucar", stock: 0, minStock: 9, isLowStock: false }),
    ];
    render(<InventoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /stock bajo/i }));
    expect(screen.getByRole("button", { name: "Arroz" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Azucar" })).not.toBeInTheDocument();
  });

  it("keeps stock for products but hides and clears stock when saving services", async () => {
    render(<InventoryPage />);
    const dialog = openCreate();
    expect(within(dialog).getByLabelText("Stock")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Stock Mín.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Stock"), { target: { value: "17" } });
    fireEvent.change(within(dialog).getByLabelText("Tipo"), { target: { value: "SERVICE" } });
    expect(within(dialog).queryByRole("group", { name: /inventario/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: /stock|inventario/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Stock")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Stock Mín.")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Instalación" } });
    fireEvent.change(within(dialog).getByLabelText("SKU"), { target: { value: "SRV-1" } });
    fireEvent.change(within(dialog).getByLabelText("Categoría"), { target: { value: "cat-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      type: "SERVICE", tracksStock: false, stock: 0, minStock: 0, categoryId: "cat-1",
    })));
  });

  it("submits product prices, tax, stock and a selected promotion", async () => {
    render(<InventoryPage />);
    const dialog = openCreate();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Café" } });
    fireEvent.change(within(dialog).getByLabelText("SKU"), { target: { value: "CAF-1" } });
    fireEvent.change(within(dialog).getByLabelText("Categoría"), { target: { value: "cat-1" } });
    fireEvent.change(within(dialog).getByLabelText("Precio de Costo"), { target: { value: "1000" } });
    fireEvent.change(within(dialog).getByLabelText("Precio de Venta"), { target: { value: "2000" } });
    fireEvent.change(within(dialog).getByLabelText("Impuesto (%)"), { target: { value: "19" } });
    fireEvent.change(within(dialog).getByLabelText("Stock"), { target: { value: "7" } });
    fireEvent.change(within(dialog).getByLabelText("Sin oferta"), { target: { value: "PERCENTAGE" } });
    fireEvent.change(within(dialog).getByPlaceholderText("Valor"), { target: { value: "15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Café", sku: "CAF-1", costPrice: 1000, salePrice: 2000,
      taxRate: 19, stock: 7, type: "PRODUCT", promotionType: "PERCENTAGE", promotionValue: 15,
    })));
  });

  it("shows the offer value only for a promotion and clears it on removal", async () => {
    products = [product({ promotionType: "PERCENTAGE", promotionValue: 10 })];
    render(<InventoryPage />);
    const dialog = openEdit();
    expect(within(dialog).getByDisplayValue("10")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitar oferta" }));
    expect(within(dialog).queryByPlaceholderText("Valor")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ promotionType: null, promotionValue: null }),
    })));
  });

  it("focuses barcode on create and Enter advances to name without saving", async () => {
    render(<InventoryPage />);
    const dialog = openCreate();
    const barcode = within(dialog).getByLabelText("Código de Barras");
    await waitFor(() => expect(barcode).toHaveFocus());
    fireEvent.keyDown(barcode, { key: "Enter", code: "Enter" });
    expect(within(dialog).getByLabelText("Nombre")).toHaveFocus();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not allow saving an inactive product or opening the form for a cashier", () => {
    products = [product({ active: false })];
    render(<InventoryPage />);
    const dialog = openEdit();
    expect(within(dialog).getByRole("button", { name: "Reactivar desde la tarjeta" })).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
    cleanup();
    role = "CASHIER";
    render(<InventoryPage />);
    expect(screen.queryByRole("button", { name: "Nuevo Producto" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Panela" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("groups identity, prices, inventory, and promotion in a compact responsive form", () => {
    render(<InventoryPage />);
    const dialog = openCreate();
    const identity = within(dialog).getByRole("group", { name: /identidad/i });
    const prices = within(dialog).getByRole("group", { name: /precios/i });
    const inventory = within(dialog).getByRole("group", { name: /inventario/i });
    const promotion = within(dialog).getByRole("group", { name: /oferta/i });
    expect(within(identity).getByLabelText("Nombre")).toBeInTheDocument();
    expect(within(prices).getByLabelText("Precio de Venta")).toBeInTheDocument();
    expect(within(inventory).getByLabelText("Stock")).toBeInTheDocument();
    expect(within(promotion).getByText("Sin oferta")).toBeInTheDocument();
    const media = within(identity).getByTestId("product-image");
    expect(media.parentElement?.className).not.toMatch(/max-w-56/);
    expect(identity.querySelector(".grid")?.className).toMatch(/md:grid-cols-/);
    expect(prices.querySelector(".grid")?.className).toMatch(/grid-cols-1.*sm:grid-cols-2/);
    expect(inventory.querySelector(".grid")?.className).toMatch(/grid-cols-1.*sm:grid-cols-2/);

    fireEvent.change(within(identity).getByLabelText("Tipo"), { target: { value: "SERVICE" } });
    expect(within(dialog).queryByRole("group", { name: /inventario/i })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: /precios/i })).toBeInTheDocument();
  });

  it("gives the image a wider column and a full-width container without the old cap", () => {
    render(<InventoryPage />);
    const dialog = openCreate();
    const identity = within(dialog).getByRole("group", { name: /identidad/i });
    const grid = identity.querySelector(".grid")!;
    expect(grid.className).toContain("md:grid-cols-[minmax(0,19.5rem)_minmax(0,1fr)]");
    expect(grid.className).not.toContain("12rem");
    const imageColumn = within(identity).getByTestId("product-image").parentElement!;
    expect(imageColumn.className).not.toContain("max-w-56");
    expect(imageColumn.className).not.toContain("mx-auto");
    const label = within(imageColumn).getByText("Imagen del producto");
    expect(label.className).not.toContain("text-center");
  });

  it("renders the product image in hero mode", () => {
    products = [product({ imageUrl: "/images/panela.jpg" })];
    render(<InventoryPage />);
    const dialog = openEdit();
    const media = within(dialog).getByTestId("product-image");
    const preview = within(media).getByRole("img", { name: "Preview" }).parentElement!;
    expect(preview).toHaveClass("aspect-[4/3]", "md:aspect-square");
    expect(within(media).getByRole("button", { name: "Cambiar" }).textContent?.trim()).toBe("");
    expect(within(media).getByRole("button", { name: "Eliminar" }).textContent?.trim()).toBe("");
    cleanup();
    products = [];
    render(<InventoryPage />);
    const createDialog = openCreate();
    expect(within(createDialog).getByRole("button", { name: /Seleccionar imagen/ })).toHaveClass("aspect-[4/3]", "md:aspect-square");
  });

  it("keeps Descripción inside the identity group, spanning both right-column sub-columns, and still edits and saves it", async () => {
    products = [product()];
    render(<InventoryPage />);
    const dialog = openEdit();
    const identity = within(dialog).getByRole("group", { name: /identidad/i });
    const description = within(identity).getByLabelText("Descripción");
    expect(description.tagName).toBe("TEXTAREA");
    expect(description).toHaveValue("Dulce");
    expect(description.parentElement).toHaveClass("sm:col-span-2");
    expect(description.parentElement?.parentElement).toBe(within(identity).getByLabelText("Nombre").parentElement?.parentElement);
    expect(within(dialog).getAllByLabelText("Descripción")).toHaveLength(1);
    fireEvent.change(description, { target: { value: "Dulce de caña" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: "Dulce de caña" }),
    })));
  });
});
