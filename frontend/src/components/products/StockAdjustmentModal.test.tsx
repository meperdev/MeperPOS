import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProductSiteStock } from "@/hooks/useProductStock";

/**
 * T22 — "Ajustar existencias": one signed move at one chosen site.
 *
 * The dialog is the replacement for the absolute stock field: it says which
 * site moves, whether the units enter or leave, and why. The api refuses a
 * negative move that would leave reservations uncovered, so the dialog caps a
 * withdrawal at what the site can actually give and explains an empty one
 * instead of offering a button that can only fail.
 */
const { adjustMutateAsync, toastSuccess, toastError, state } = vi.hoisted(() => ({
  adjustMutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  state: { pending: false },
}));

vi.mock("@/hooks/useProductStock", () => ({
  productStockQueryKey: (productId: string) => ["product-stock", productId],
  useProductStockBySite: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAdjustProductStock: () => ({
    mutateAsync: adjustMutateAsync,
    isPending: state.pending,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

import { StockAdjustmentModal } from "./StockAdjustmentModal";

const principal: ProductSiteStock = {
  locationId: "site-a",
  name: "Sede centro",
  type: "STORE",
  isDefault: true,
  stock: 5,
  reservedStock: 1,
  availableStock: 4,
};
const warehouse: ProductSiteStock = {
  locationId: "site-b",
  name: "Bodega norte",
  type: "WAREHOUSE",
  isDefault: false,
  stock: 0,
  reservedStock: 0,
  availableStock: 0,
};

const renderModal = (sites: ProductSiteStock[] = [principal, warehouse]) =>
  render(
    <StockAdjustmentModal
      isOpen
      onClose={vi.fn()}
      productId="p-1"
      productName="Café molido"
      sites={sites}
    />,
  );

const dialog = () => screen.getByRole("dialog");
const quantityGroup = () => within(dialog()).getByRole("group", { name: "Cantidad" });

describe("StockAdjustmentModal", () => {
  beforeEach(() => {
    state.pending = false;
    adjustMutateAsync.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to the principal site and shows what that site holds", () => {
    renderModal();

    expect(
      within(dialog()).getByRole("button", { name: "Sede" }),
    ).toHaveTextContent("Sede centro");
    expect(dialog()).toHaveTextContent("5 uds.");
    expect(dialog()).toHaveTextContent("4 disponibles");
  });

  it("sends a positive move for an entry and a negative one for a withdrawal", async () => {
    const user = userEvent.setup();
    adjustMutateAsync.mockResolvedValue({});
    const { unmount } = renderModal();

    await user.click(
      within(quantityGroup()).getByRole("button", {
        name: "Aumentar cantidad",
      }),
    );
    await user.type(within(dialog()).getByLabelText(/Motivo/), "Conteo físico");
    await user.click(
      within(dialog()).getByRole("button", { name: "Guardar ajuste" }),
    );

    expect(adjustMutateAsync).toHaveBeenCalledWith({
      productId: "p-1",
      locationId: "site-a",
      quantity: 2,
      reason: "Conteo físico",
    });
    expect(toastSuccess).toHaveBeenCalled();
    unmount();

    vi.clearAllMocks();
    renderModal();
    await user.click(within(dialog()).getByRole("button", { name: "Salida" }));
    await user.type(within(dialog()).getByLabelText(/Motivo/), "  Merma  ");
    await user.click(
      within(dialog()).getByRole("button", { name: "Guardar ajuste" }),
    );

    expect(adjustMutateAsync).toHaveBeenCalledWith({
      productId: "p-1",
      locationId: "site-a",
      quantity: -1,
      reason: "Merma",
    });
  });

  it("refuses to withdraw from a site with nothing available", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      within(dialog()).getByRole("button", { name: "Sede" }),
    );
    await user.click(
      await screen.findByRole("option", { name: /Bodega norte/ }),
    );
    await user.click(within(dialog()).getByRole("button", { name: "Salida" }));

    expect(dialog()).toHaveTextContent(
      "Esta sede no tiene unidades disponibles para retirar.",
    );
    expect(
      within(dialog()).getByRole("button", { name: "Guardar ajuste" }),
    ).toBeDisabled();
  });

  it("never submits the product editor form it is opened from", async () => {
    // The dialog is portaled to the body, but React still bubbles its submit
    // through the component tree to the editor's <form>, which used to save
    // the product with a stale version at the same time.
    const user = userEvent.setup();
    adjustMutateAsync.mockResolvedValue({});
    const outerSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={outerSubmit}>
        <StockAdjustmentModal
          isOpen
          onClose={vi.fn()}
          productId="p-1"
          productName="Café molido"
          sites={[principal, warehouse]}
        />
      </form>,
    );
    fireEvent.change(within(dialog()).getByLabelText(/Motivo/), {
      target: { value: "Conteo físico" },
    });
    await user.click(
      within(dialog()).getByRole("button", { name: "Guardar ajuste" }),
    );

    expect(adjustMutateAsync).toHaveBeenCalledTimes(1);
    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it("requires a motive and a whole number of units", async () => {
    const user = userEvent.setup();
    renderModal();

    const submit = within(dialog()).getByRole("button", {
      name: "Guardar ajuste",
    });
    // No motive yet.
    expect(submit).toBeDisabled();

    await user.type(within(dialog()).getByLabelText(/Motivo/), "   ");
    expect(submit).toBeDisabled();

    await user.type(within(dialog()).getByLabelText(/Motivo/), "Corrección");
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(adjustMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "Corrección", quantity: 1 }),
    );
  });

  it("reports a refused move without closing the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    adjustMutateAsync.mockRejectedValue(new Error("409"));
    render(
      <StockAdjustmentModal
        isOpen
        onClose={onClose}
        productId="p-1"
        productName="Café molido"
        sites={[principal]}
      />,
    );

    // Set directly: the dialog moves focus to its first field on the next
    // animation frame, which can swallow keystrokes typed before it.
    fireEvent.change(within(dialog()).getByLabelText(/Motivo/), {
      target: { value: "Merma" },
    });
    await user.click(
      within(dialog()).getByRole("button", { name: "Guardar ajuste" }),
    );

    expect(toastError).toHaveBeenCalledWith(
      "No se pudo ajustar las existencias",
      expect.objectContaining({
        description: "Revisa la sede y la cantidad.",
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
