import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { settingsData, useSettingsMock } = vi.hoisted(() => ({
  settingsData: {
    organization: { name: "Mi Empresa", logoUrl: null },
    invoicing: { printHeader: "", printFooter: "" },
    receipt: { prefix: null },
    locale: { currency: "COP", locale: "es-CO", timezone: "America/Bogota" },
    custom: {},
  },
  useSettingsMock: vi.fn(),
}));

const useSettingsRefetchMock = vi.fn();

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => useSettingsMock(),
}));

import LocaleSettingsPage from "./page";

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

describe("Currency & Locale settings page", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows currency, locale and timezone as read-only values", () => {
    mockQueryState({ data: settingsData, isError: false, error: null });
    render(<LocaleSettingsPage />);

    expect(screen.getByText("COP")).toBeInTheDocument();
    expect(screen.getByText("es-CO")).toBeInTheDocument();
    expect(screen.getByText("America/Bogota")).toBeInTheDocument();
  });

  it("renders no editable fields or save button", () => {
    mockQueryState({ data: settingsData, isError: false, error: null });
    render(<LocaleSettingsPage />);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /guardar/i })).toBeNull();
  });

  it("shows the error state with retry when the query failed, without loading or values", async () => {
    mockQueryState({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
    });
    render(<LocaleSettingsPage />);

    expect(
      screen.getByText("No se pudo cargar la configuración."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cargando configuración…")).toBeNull();
    expect(screen.queryByText("COP")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(useSettingsRefetchMock).toHaveBeenCalled();
  });

  it("recovers to the form when the retry query succeeds", () => {
    mockQueryState({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
    });
    const { rerender } = render(<LocaleSettingsPage />);

    expect(
      screen.getByText("No se pudo cargar la configuración."),
    ).toBeInTheDocument();

    mockQueryState({ data: settingsData, isError: false, error: null });
    rerender(<LocaleSettingsPage />);

    expect(screen.queryByText("No se pudo cargar la configuración.")).toBeNull();
    expect(screen.getByText("COP")).toBeInTheDocument();
  });
});
