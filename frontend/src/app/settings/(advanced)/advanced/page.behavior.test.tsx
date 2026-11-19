import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { settingsData, useSettingsMock } = vi.hoisted(() => ({
  settingsData: {
    organization: { name: "Mi Empresa", logoUrl: null },
    invoicing: { printHeader: "", printFooter: "" },
    receipt: { prefix: null },
    locale: { currency: "COP", locale: "es-CO", timezone: "America/Bogota" },
    custom: { theme: "dark" },
  },
  useSettingsMock: vi.fn(),
}));

const updateSettingsMutateAsyncMock = vi.fn();
const useSettingsRefetchMock = vi.fn();

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => useSettingsMock(),
  useUpdateSettings: () => ({
    mutateAsync: updateSettingsMutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import AdvancedSettingsPage from "./page";

function mockQueryState(overrides: {
  data?: typeof settingsData | undefined;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
}) {
  useSettingsRefetchMock.mockReset();
  useSettingsMock.mockReturnValue({
    data: overrides.data ?? undefined,
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: overrides.error ?? null,
    refetch: useSettingsRefetchMock,
  });
}

describe("Advanced settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSettingsMutateAsyncMock.mockResolvedValue(settingsData);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders existing custom key/value entries", () => {
    mockQueryState({ data: settingsData, isError: false, error: null });
    render(<AdvancedSettingsPage />);

    expect(screen.getByDisplayValue("theme")).toBeInTheDocument();
    expect(screen.getByDisplayValue("dark")).toBeInTheDocument();
  });

  it("adds a key/value row and saves the merged custom object", async () => {
    mockQueryState({ data: settingsData, isError: false, error: null });
    const user = userEvent.setup();
    render(<AdvancedSettingsPage />);

    await user.click(screen.getByRole("button", { name: /agregar/i }));

    const keys = screen.getAllByLabelText(/clave/i);
    const values = screen.getAllByLabelText(/valor/i);
    await user.type(keys[1], "color");
    await user.type(values[1], "rojo");

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(updateSettingsMutateAsyncMock).toHaveBeenCalledWith({
      custom: { theme: "dark", color: "rojo" },
    });
  });

  it("asks for the removal inside the row and drops the key only on confirm", async () => {
    mockQueryState({ data: settingsData, isError: false, error: null });
    const user = userEvent.setup();
    render(<AdvancedSettingsPage />);

    await user.click(screen.getByRole("button", { name: "Eliminar clave theme" }));

    // The first press only arms the row's own control; nothing is lost yet and
    // no dialog takes over the screen.
    expect(screen.getByDisplayValue("theme")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "¿Eliminar?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "¿Eliminar?" }));

    expect(screen.queryByDisplayValue("theme")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(updateSettingsMutateAsyncMock).toHaveBeenCalledWith({ custom: {} });
  });

  it("keeps the key when the inline confirm is cancelled", async () => {
    mockQueryState({ data: settingsData, isError: false, error: null });
    const user = userEvent.setup();
    render(<AdvancedSettingsPage />);

    await user.click(screen.getByRole("button", { name: "Eliminar clave theme" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByDisplayValue("theme")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "¿Eliminar?" })).toBeNull();
  });

  it("shows the error state with retry when the query failed, without loading or the editor", async () => {
    mockQueryState({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
    });
    render(<AdvancedSettingsPage />);

    expect(
      screen.getByText("No se pudo cargar la configuración."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cargando configuración…")).toBeNull();
    expect(screen.queryByDisplayValue("theme")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(useSettingsRefetchMock).toHaveBeenCalled();
  });

  it("recovers the editor when the retry query succeeds", () => {
    mockQueryState({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
    });
    const { rerender } = render(<AdvancedSettingsPage />);

    expect(
      screen.getByText("No se pudo cargar la configuración."),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("theme")).toBeNull();

    mockQueryState({ data: settingsData, isError: false, error: null });
    rerender(<AdvancedSettingsPage />);

    expect(screen.queryByText("No se pudo cargar la configuración.")).toBeNull();
    expect(screen.getByDisplayValue("theme")).toBeInTheDocument();
  });
});
