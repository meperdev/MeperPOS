import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { LocationSite } from "@/types";

const {
  createMutateAsync,
  updateMutateAsync,
  toastSuccess,
  toastError,
  state,
} = vi.hoisted(() => {
  const state = {
    sites: [] as LocationSite[],
    isLoading: false,
    isError: false,
  };
  return {
    createMutateAsync: vi.fn(),
    updateMutateAsync: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    state,
  };
});

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("@/hooks/useLocations", () => ({
  useLocations: () => ({
    data: state.isLoading || state.isError ? undefined : state.sites,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useCreateLocation: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateLocation: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

import LocationsPage from "./page";

const principal: LocationSite = {
  id: "site-a",
  name: "Sede centro",
  type: "STORE",
  isDefault: true,
};
const warehouse: LocationSite = {
  id: "site-b",
  name: "Bodega norte",
  type: "WAREHOUSE",
  isDefault: false,
};

beforeEach(() => {
  state.sites = [];
  state.isLoading = false;
  state.isError = false;
  vi.clearAllMocks();
  createMutateAsync.mockResolvedValue({});
  updateMutateAsync.mockResolvedValue({});
});

afterEach(cleanup);

describe("site management page", () => {
  it("lists each site with its type and marks the principal one", () => {
    state.sites = [principal, warehouse];
    render(<LocationsPage />);

    expect(screen.getByText("Sede centro")).toBeInTheDocument();
    expect(screen.getByText("Bodega norte")).toBeInTheDocument();
    expect(screen.getByText("Sucursal")).toBeInTheDocument();
    expect(screen.getByText("Bodega")).toBeInTheDocument();
    expect(screen.getByText("Principal")).toBeInTheDocument();
    expect(screen.getByText("2 sedes")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editar sede Bodega norte" }),
    ).toBeInTheDocument();
  });

  it("invites the first site when the organization has none", () => {
    render(<LocationsPage />);

    expect(screen.getByText("Sin sedes todavía")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Nueva sede/ }),
    ).toBeInTheDocument();
  });

  it("offers a retry when the directory cannot be read", () => {
    state.isError = true;
    render(<LocationsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las sedes.",
    );
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
  });

  it("creates a warehouse from the new-site dialog", async () => {
    const user = userEvent.setup();
    render(<LocationsPage />);

    await user.click(screen.getByRole("button", { name: /Nueva sede/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Nombre/ }), "  Bodega sur  ");
    await user.click(within(dialog).getByRole("button", { name: "Tipo" }));
    await user.click(await screen.findByRole("option", { name: "Bodega" }));
    await user.click(within(dialog).getByRole("button", { name: "Crear sede" }));

    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith({
        name: "Bodega sur",
        type: "WAREHOUSE",
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Sede creada",
      expect.objectContaining({
        description: "Asigna el acceso a cada persona desde Usuarios.",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renames the principal site without offering a type change", async () => {
    state.sites = [principal];
    const user = userEvent.setup();
    render(<LocationsPage />);

    await user.click(
      screen.getByRole("button", { name: "Editar sede Sede centro" }),
    );
    const dialog = screen.getByRole("dialog");
    const nameField = within(dialog).getByRole("textbox", { name: /Nombre/ });
    expect(nameField).toHaveValue("Sede centro");
    expect(within(dialog).getByRole("button", { name: "Tipo" })).toBeDisabled();
    expect(dialog).toHaveTextContent(
      "La sede principal opera el punto de venta, así que se mantiene como sucursal.",
    );

    await user.clear(nameField);
    await user.type(nameField, "Sede principal");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: principal.id,
        data: { name: "Sede principal" },
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Sede actualizada", {
      description: "Sede principal",
    });
  });

  it("changes the type of a non-principal site", async () => {
    state.sites = [warehouse];
    const user = userEvent.setup();
    render(<LocationsPage />);

    await user.click(
      screen.getByRole("button", { name: "Editar sede Bodega norte" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Tipo" }));
    await user.click(await screen.findByRole("option", { name: "Sucursal" }));
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: warehouse.id,
        data: { name: "Bodega norte", type: "STORE" },
      }),
    );
  });

  it("keeps the dialog open and reports a rejected save", async () => {
    createMutateAsync.mockRejectedValueOnce(new Error("conflict"));
    const user = userEvent.setup();
    render(<LocationsPage />);

    await user.click(screen.getByRole("button", { name: /Nueva sede/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Nombre/ }), "Bodega norte");
    await user.click(within(dialog).getByRole("button", { name: "Crear sede" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith("No se pudo guardar la sede", {
      description: "Revisa el nombre y el tipo de sede.",
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
