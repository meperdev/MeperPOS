import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    organization: { name: "Mi Empresa", logoUrl: null },
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

import GeneralSettingsPage from "./page";

describe("General settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadLogoMutateAsyncMock.mockResolvedValue({ logoUrl: "https://cdn/logo.png" });
    updateOrganizationNameMutateAsyncMock.mockResolvedValue(settingsData);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the organization name as an editable input", () => {
    render(<GeneralSettingsPage />);
    expect(screen.getByLabelText(/nombre de la organización/i)).toHaveValue(
      "Mi Empresa"
    );
  });

  it("saves the organization name through the organization endpoint", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    const nameInput = screen.getByLabelText(/nombre de la organización/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Nueva empresa");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateOrganizationNameMutateAsyncMock).toHaveBeenCalledWith(
      "Nueva empresa"
    );
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

  it("does not expose legacy company/currency/tax/prefix fields", () => {
    render(<GeneralSettingsPage />);
    expect(screen.queryByLabelText(/nombre de la empresa/i)).toBeNull();
    expect(screen.queryByLabelText(/moneda/i)).toBeNull();
    expect(screen.queryByLabelText(/impuesto/i)).toBeNull();
    expect(screen.queryByLabelText(/prefijo/i)).toBeNull();
  });
});
