import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  updateSettingsMutateAsyncMock,
  updateReceiptPrefixMutateAsyncMock,
  toastSuccessMock,
  settingsData,
} = vi.hoisted(() => ({
  updateSettingsMutateAsyncMock: vi.fn(),
  updateReceiptPrefixMutateAsyncMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  settingsData: {
    organization: { name: "Mi Empresa", logoUrl: null },
    invoicing: { printHeader: "Header actual", printFooter: "Footer actual" },
    receipt: { prefix: "REC-" },
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
  useUpdateReceiptPrefix: () => ({
    mutateAsync: updateReceiptPrefixMutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import InvoicingSettingsPage from "./page";

describe("Invoicing & Receipts settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSettingsMutateAsyncMock.mockResolvedValue(settingsData);
    updateReceiptPrefixMutateAsyncMock.mockResolvedValue(settingsData);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows print header/footer and the editable receipt prefix", () => {
    render(<InvoicingSettingsPage />);
    const preview = within(screen.getByRole("article", { name: /vista previa del comprobante/i }));

    expect(screen.getByLabelText(/encabezado/i)).toHaveValue("Header actual");
    expect(screen.getByLabelText(/pie de página/i)).toHaveValue("Footer actual");
    expect(screen.getByLabelText(/prefijo/i)).toHaveValue("REC-");
    expect(preview.getByText("Mi Empresa")).toBeInTheDocument();
    expect(preview.getByText("Header actual")).toBeInTheDocument();
    expect(preview.getByText("Footer actual")).toBeInTheDocument();
    expect(preview.getByText(/REC-000184/)).toBeInTheDocument();
  });

  it("shows a balanced fallback when the organization has no logo", () => {
    render(<InvoicingSettingsPage />);

    expect(screen.getByLabelText("Sin logo configurado")).toBeInTheDocument();
  });

  it("updates the preview as the form values change", async () => {
    const user = userEvent.setup();
    render(<InvoicingSettingsPage />);
    const preview = within(screen.getByRole("article", { name: /vista previa del comprobante/i }));

    const header = screen.getByLabelText(/encabezado/i);
    const prefix = screen.getByLabelText(/prefijo/i);

    await user.clear(header);
    await user.type(header, "Nuevo encabezado");
    await user.clear(prefix);
    await user.type(prefix, "FAC-");

    expect(preview.getByText("Nuevo encabezado")).toBeInTheDocument();
    expect(preview.getByText(/FAC-000184/)).toBeInTheDocument();
  });

  it("saves only printHeader and printFooter on submit", async () => {
    const user = userEvent.setup();
    render(<InvoicingSettingsPage />);

    const header = screen.getByLabelText(/encabezado/i);
    await user.clear(header);
    await user.type(header, "Nuevo encabezado");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateSettingsMutateAsyncMock).toHaveBeenCalledWith({
      printHeader: "Nuevo encabezado",
      printFooter: "Footer actual",
    });
  });

  it("saves the receipt prefix through the receipt-prefix endpoint", async () => {
    const user = userEvent.setup();
    render(<InvoicingSettingsPage />);

    const prefix = screen.getByLabelText(/prefijo/i);
    await user.clear(prefix);
    await user.type(prefix, "FAC-");
    await user.click(screen.getByRole("button", { name: "Guardar prefijo" }));

    expect(updateReceiptPrefixMutateAsyncMock).toHaveBeenCalledWith("FAC-");
  });

  it("sizes the two columns by the content container, so the form keeps its width", () => {
    render(<InvoicingSettingsPage />);

    const grid = screen
      .getByText("Impresión de comprobantes")
      .closest("section")!
      .parentElement!.parentElement!;

    expect(grid.parentElement!.className).toContain("@container");
    expect(grid.className).toContain(
      "@4xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]",
    );
    expect(grid.className).not.toContain("lg:grid-cols");
    expect(grid.className).not.toContain("lg:gap-5");
    expect(grid.className).toContain("@4xl:gap-5");

    const previewWrapper = grid.children[1] as HTMLElement;
    expect(
      previewWrapper.contains(
        screen.getByRole("article", { name: /vista previa del comprobante/i }),
      ),
    ).toBe(true);
    expect(previewWrapper.className).toContain("@4xl:sticky");
    expect(previewWrapper.className).not.toContain("lg:sticky");
  });
});
