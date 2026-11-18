import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { updateSettingsMutateAsyncMock, toastSuccessMock, toastErrorMock, settingsData } =
  vi.hoisted(() => ({
    updateSettingsMutateAsyncMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
    settingsData: {
      organization: {
        name: "Tienda Meper",
        logoUrl: null,
        taxId: "901000111-1",
        phone: "6011234567",
        address: "Calle 1 # 2-3",
      },
      invoicing: { printHeader: "", printFooter: "" },
      receipt: { prefix: null },
      purchaseOrder: {
        deliveryAddress: "",
        paymentTerms: "Contado",
        terms: "Se recibe solo mercancía con factura",
        footer: "Gracias por su atención",
      },
      locale: { currency: "COP", locale: "es-CO", timezone: "America/Bogota" },
      custom: {},
    },
  }));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ data: settingsData, isLoading: false }),
  useUpdateSettings: () => ({
    mutateAsync: updateSettingsMutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

import PurchaseOrderSettingsPage from "./page";

const preview = () =>
  within(
    screen.getByRole("article", {
      name: /vista previa de la orden de compra/i,
    }),
  );

describe("Purchase order settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSettingsMutateAsyncMock.mockResolvedValue(settingsData);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the stored template in the form and in the preview", () => {
    render(<PurchaseOrderSettingsPage />);

    expect(screen.getByLabelText(/dirección de entrega/i)).toHaveValue("");
    expect(screen.getByLabelText(/condiciones de pago/i)).toHaveValue("Contado");
    expect(screen.getByLabelText(/términos y condiciones/i)).toHaveValue(
      "Se recibe solo mercancía con factura",
    );
    expect(screen.getByLabelText(/pie de página/i)).toHaveValue(
      "Gracias por su atención",
    );

    expect(preview().getByText("Tienda Meper")).toBeInTheDocument();
    expect(preview().getByText("NIT 901000111-1")).toBeInTheDocument();
    expect(preview().getByText("Contado")).toBeInTheDocument();
    expect(
      preview().getByText("Se recibe solo mercancía con factura"),
    ).toBeInTheDocument();
    expect(preview().getByText("Gracias por su atención")).toBeInTheDocument();
  });

  it("delivers to the business address while the delivery address is empty", async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderSettingsPage />);

    expect(
      preview().getByLabelText("Entregar en").textContent,
    ).toBe("Calle 1 # 2-3");

    await user.type(screen.getByLabelText(/dirección de entrega/i), "Bodega 4");

    expect(preview().getByLabelText("Entregar en").textContent).toBe("Bodega 4");
  });

  it("updates the preview as the fields change", async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderSettingsPage />);

    const terms = screen.getByLabelText(/condiciones de pago/i);
    await user.clear(terms);
    await user.type(terms, "Crédito a 30 días");

    expect(preview().getByText("Crédito a 30 días")).toBeInTheDocument();
  });

  it("saves the four template fields", async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderSettingsPage />);

    await user.type(screen.getByLabelText(/dirección de entrega/i), "Bodega 4");
    await user.click(screen.getByRole("button", { name: "Guardar plantilla" }));

    expect(updateSettingsMutateAsyncMock).toHaveBeenCalledWith({
      purchaseOrderTemplate: {
        deliveryAddress: "Bodega 4",
        paymentTerms: "Contado",
        terms: "Se recibe solo mercancía con factura",
        footer: "Gracias por su atención",
      },
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Plantilla guardada");
  });

  it("reports a failed save", async () => {
    const user = userEvent.setup();
    updateSettingsMutateAsyncMock.mockRejectedValue(new Error("boom"));
    render(<PurchaseOrderSettingsPage />);

    await user.click(screen.getByRole("button", { name: "Guardar plantilla" }));

    expect(toastErrorMock).toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
