import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  uploadLogoMutateAsyncMock,
  updateOrganizationNameMutateAsyncMock,
  toastSuccessMock,
  settingsData,
} = vi.hoisted(() => ({
  uploadLogoMutateAsyncMock: vi.fn(),
  updateOrganizationNameMutateAsyncMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  settingsData: {
    organization: { name: "Mi Empresa", logoUrl: null as string | null },
    invoicing: { printHeader: "", printFooter: "" },
    receipt: { prefix: "REC-" },
    locale: { currency: "COP", locale: "es-CO", timezone: "America/Bogota" },
    custom: {},
  },
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => (
    <span role="img" aria-label={props.alt ?? "image"} />
  ),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ data: settingsData, isLoading: false }),
  useUploadLogo: () => ({
    mutateAsync: uploadLogoMutateAsyncMock,
    isPending: false,
  }),
  useUpdateOrganizationName: () => ({
    mutateAsync: updateOrganizationNameMutateAsyncMock,
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

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

import GeneralSettingsPage from "./page";

describe("General settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsData.organization.logoUrl = null;
    uploadLogoMutateAsyncMock.mockResolvedValue({ logoUrl: "https://cdn/logo.png" });
    updateOrganizationNameMutateAsyncMock.mockResolvedValue(settingsData);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the organization name as an editable input", () => {
    render(<GeneralSettingsPage />);
    expect(screen.getByLabelText(/nombre del negocio/i)).toHaveValue(
      "Mi Empresa"
    );
  });

  it("keeps the save action disabled until the name changes", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    const nameInput = screen.getByLabelText(/nombre del negocio/i);
    const save = screen.getByRole("button", { name: "Guardar" });
    expect(save).toBeDisabled();

    await user.type(nameInput, " y Cía");
    expect(save).toBeEnabled();

    // Returning to the saved value leaves nothing to save.
    await user.clear(nameInput);
    await user.type(nameInput, "Mi Empresa");
    expect(save).toBeDisabled();
  });

  it("saves the organization name through the organization endpoint", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    const nameInput = screen.getByLabelText(/nombre del negocio/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Nueva empresa");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateOrganizationNameMutateAsyncMock).toHaveBeenCalledWith(
      "Nueva empresa"
    );
  });

  it("caps the business name input at 100 characters", () => {
    render(<GeneralSettingsPage />);

    expect(screen.getByLabelText(/nombre del negocio/i)).toHaveAttribute(
      "maxLength",
      "100"
    );
  });

  it("stops typing at 100 characters and saves only the capped name", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    const nameInput = screen.getByLabelText(/nombre del negocio/i);
    await user.clear(nameInput);
    await user.type(nameInput, "a".repeat(105));
    expect(nameInput).toHaveValue("a".repeat(100));

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateOrganizationNameMutateAsyncMock).toHaveBeenCalledWith(
      "a".repeat(100)
    );
  });

  it("blocks a name over 100 characters that bypasses the input cap", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    // A programmatic value (autofill, script) is not truncated by maxLength.
    const nameInput = screen.getByLabelText(/nombre del negocio/i);
    fireEvent.change(nameInput, { target: { value: "a".repeat(1000) } });
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateOrganizationNameMutateAsyncMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("El nombre no puede superar los 100 caracteres.")
    ).toBeInTheDocument();
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
  });

  it("mirrors the typed name in the receipt header preview", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    const preview = within(
      screen.getByRole("article", { name: /cabecera del comprobante/i })
    );
    expect(preview.getByText("Mi Empresa")).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/nombre del negocio/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Panadería Central");
    expect(preview.getByText("Panadería Central")).toBeInTheDocument();

    // An empty draft keeps the receipt header legible instead of blank.
    await user.clear(nameInput);
    expect(preview.getByText("Nombre del negocio")).toBeInTheDocument();
  });

  it("shows an empty logo state without a logo", () => {
    render(<GeneralSettingsPage />);

    expect(screen.getByText("Sin logo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /subir logo/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Logo del negocio" })).toBeNull();
  });

  it("shows the current logo with a replace action", () => {
    settingsData.organization.logoUrl = "https://cdn/logo.png";
    render(<GeneralSettingsPage />);

    expect(
      screen.getByRole("img", { name: "Logo del negocio" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Sin logo")).toBeNull();
    expect(
      screen.getByRole("button", { name: /reemplazar logo/i })
    ).toBeInTheDocument();
  });

  it("uploads a logo through the logo endpoint", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    const fileInput = screen.getByLabelText(/logo/i);
    const file = new File(["logo"], "logo.png", { type: "image/png" });
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(uploadLogoMutateAsyncMock).toHaveBeenCalledWith(file);
    });
  });

  it("splits each settings row into two columns on large screens", () => {
    render(<GeneralSettingsPage />);

    const row = screen
      .getByRole("heading", { name: "Nombre del negocio" })
      .parentElement!.parentElement!;

    expect(row.className).toContain(
      "lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
    );
    expect(row.className).not.toContain("md:grid-cols");
  });

  it("does not expose legacy company/currency/tax/prefix fields", () => {
    render(<GeneralSettingsPage />);
    expect(screen.queryByLabelText(/nombre de la empresa/i)).toBeNull();
    expect(screen.queryByLabelText(/moneda/i)).toBeNull();
    expect(screen.queryByLabelText(/impuesto/i)).toBeNull();
    expect(screen.queryByLabelText(/prefijo/i)).toBeNull();
  });

  it("offers the appearance card with the theme radiogroup", () => {
    render(<GeneralSettingsPage />);

    expect(
      screen.getByRole("heading", { name: "Apariencia" })
    ).toBeInTheDocument();

    const group = screen.getByRole("radiogroup", { name: "Tema de la interfaz" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((item) => item.textContent)).toEqual(["Claro", "Oscuro"]);
  });
});
