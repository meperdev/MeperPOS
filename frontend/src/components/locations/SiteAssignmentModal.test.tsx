import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LocationSite, User } from "@/types";

const {
  assignmentsQuery,
  replaceMutateAsync,
  toastSuccess,
  toastError,
  state,
} = vi.hoisted(() => {
  const state = {
    sites: [] as LocationSite[],
    assignments: undefined as
      | { locationIds: string[]; orgWideAccess: boolean }
      | undefined,
    sitesLoading: false,
    sitesError: false,
    replacePending: false,
  };
  return {
    assignmentsQuery: vi.fn(),
    replaceMutateAsync: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    state,
  };
});

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("@/hooks/useLocations", () => ({
  useLocations: () => ({
    data: state.sites,
    isLoading: state.sitesLoading,
    isError: state.sitesError,
    refetch: vi.fn(),
  }),
  useUserLocationAssignments: (userId: string | null) => {
    assignmentsQuery(userId);
    return {
      data: state.assignments,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useReplaceLocationAssignments: () => ({
    mutateAsync: replaceMutateAsync,
    isPending: state.replacePending,
  }),
}));

import { SiteAssignmentModal } from "./SiteAssignmentModal";

const cashier: User = {
  id: "user-1",
  email: "caja@example.com",
  name: "Caja Uno",
  role: "CASHIER",
  active: true,
  createdAt: "2026-03-24T00:00:00.000Z",
  updatedAt: "2026-03-24T00:00:00.000Z",
};

const admin: User = { ...cashier, id: "user-2", name: "Ana", role: "ADMIN" };

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
  state.sites = [principal, warehouse];
  state.assignments = { locationIds: [principal.id], orgWideAccess: false };
  state.sitesLoading = false;
  state.sitesError = false;
  state.replacePending = false;
  vi.clearAllMocks();
  replaceMutateAsync.mockResolvedValue({ locationIds: [] });
});

afterEach(cleanup);

describe("per-user site assignment", () => {
  it("pre-checks the sites the membership is assigned today", () => {
    render(
      <SiteAssignmentModal isOpen onClose={vi.fn()} user={cashier} />,
    );

    expect(assignmentsQuery).toHaveBeenCalledWith("user-1");
    expect(
      screen.getByRole("checkbox", { name: /Sede centro/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Bodega norte/ }),
    ).not.toBeChecked();
    expect(screen.getByText("Sucursal")).toBeInTheDocument();
    expect(screen.getByText("Bodega")).toBeInTheDocument();
  });

  it("saves the exact checked set and closes the dialog", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SiteAssignmentModal isOpen onClose={onClose} user={cashier} />);

    await user.click(screen.getByRole("checkbox", { name: /Bodega norte/ }));
    await user.click(screen.getByRole("button", { name: "Guardar sedes" }));

    await waitFor(() =>
      expect(replaceMutateAsync).toHaveBeenCalledWith({
        userId: "user-1",
        locationIds: [principal.id, warehouse.id],
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Sedes asignadas", {
      description: "Caja Uno",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("removes every assignment when nothing is checked", async () => {
    const user = userEvent.setup();
    render(<SiteAssignmentModal isOpen onClose={vi.fn()} user={cashier} />);

    await user.click(screen.getByRole("checkbox", { name: /Sede centro/ }));
    await user.click(screen.getByRole("button", { name: "Guardar sedes" }));

    await waitFor(() =>
      expect(replaceMutateAsync).toHaveBeenCalledWith({
        userId: "user-1",
        locationIds: [],
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Acceso a sedes retirado", {
      description: "Caja Uno",
    });
  });

  it("explains that administrators reach every site and offers no editing", () => {
    // The user list carries no roles, so the server's answer decides.
    state.assignments = { locationIds: [], orgWideAccess: true };
    render(<SiteAssignmentModal isOpen onClose={vi.fn()} user={admin} />);

    expect(assignmentsQuery).toHaveBeenCalledWith("user-2");
    expect(
      screen.getByText(/accede a todas las sedes de la organización/i),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Guardar sedes" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Entendido" }),
    ).toBeInTheDocument();
  });

  it("discards an unsaved change when the dialog closes", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <SiteAssignmentModal isOpen onClose={onClose} user={cashier} />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Bodega norte/ }));
    expect(
      screen.getByRole("checkbox", { name: /Bodega norte/ }),
    ).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalled();

    rerender(
      <SiteAssignmentModal isOpen={false} onClose={onClose} user={cashier} />,
    );
    rerender(<SiteAssignmentModal isOpen onClose={onClose} user={cashier} />);

    expect(
      screen.getByRole("checkbox", { name: /Bodega norte/ }),
    ).not.toBeChecked();
  });

  it("keeps the dialog open and reports a rejected assignment", async () => {
    replaceMutateAsync.mockRejectedValueOnce(new Error("conflict"));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SiteAssignmentModal isOpen onClose={onClose} user={cashier} />);

    await user.click(screen.getByRole("button", { name: "Guardar sedes" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith("No se pudieron asignar las sedes", {
      description: "Intenta de nuevo.",
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
