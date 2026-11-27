import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { User } from "@/types";

const createUserMock = vi.hoisted(() => vi.fn());
const updateUserMock = vi.hoisted(() => vi.fn());

const usersData = vi.hoisted(
  () =>
    [
      {
        id: "admin-1",
        email: "admin@example.com",
        name: "Admin Principal",
        role: "ADMIN",
        active: true,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
      {
        id: "user-2",
        email: "cashier@example.com",
        name: "Caja Uno",
        role: "CASHIER",
        active: true,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    ] satisfies User[],
);

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useUsers", () => ({
  useUsers: () => ({ data: usersData, isLoading: false }),
  useCreateUser: () => ({ mutateAsync: createUserMock, isPending: false }),
  useUpdateUser: () => ({ mutateAsync: updateUserMock, isPending: false }),
  useDeleteUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useToggleUserActive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResetUserPassword: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// The signed-in admin; the primary owner by default, overridden per test.
const currentUserMock = vi.hoisted(() => ({
  value: {
    id: "admin-1",
    role: "ADMIN",
    name: "Admin Principal",
    email: "admin@example.com",
    isPrimaryOwner: true as boolean,
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: currentUserMock.value }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Error",
}));

// The assignment dialog has its own suite; this one only owes it the right
// member and a mount point.
vi.mock("@/components/locations/SiteAssignmentModal", () => ({
  SiteAssignmentModal: ({
    isOpen,
    user,
  }: {
    isOpen: boolean;
    user: { name: string } | null;
  }) =>
    isOpen && user ? (
      <div data-testid="site-assignment-modal">{user.name}</div>
    ) : null,
}));

import UsersPage from "./UsersManagementPage";

describe("Users list responsive layout", () => {
  afterEach(() => {
    cleanup();
  });

  it("stacks each row until the list container is wide enough, and lets the identity shrink", () => {
    render(<UsersPage />);

    const row = screen.getByText("Caja Uno").closest("[class~='py-3.5']")!;
    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("@2xl:flex-row");
    expect(row.className).toContain("@2xl:items-center");
    expect(row.className).toContain("@2xl:justify-between");
    expect(row.className).not.toContain("sm:flex-row");

    expect(row.parentElement!.className).toContain("@container");

    const identity = row.firstElementChild!;
    expect(identity.className).toContain("min-w-0");
    expect(identity.className).toContain("flex-1");
    expect(screen.getByText("Caja Uno").className).toContain("truncate");

    const actions = row.lastElementChild!;
    expect(actions.className).toContain("flex-wrap");
    expect(actions.className).toContain("@2xl:shrink-0");
    expect(actions.className).toContain("@2xl:justify-end");
  });

  it("edits only name and email, never a role the API rejects", async () => {
    // PUT /users/:id has no role field and the global ValidationPipe forbids
    // unknown properties, so sending `role` made every edit fail with 400.
    updateUserMock.mockClear();
    const user = userEvent.setup();
    render(<UsersPage />);

    await user.click(
      screen.getByRole("button", { name: "Editar usuario Caja Uno" }),
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByLabelText("Rol")).toBeNull();

    const name = dialog.getByLabelText(/^Nombre/);
    await user.clear(name);
    await user.type(name, "Caja Renombrada");
    await user.click(dialog.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith({
        id: "user-2",
        data: { name: "Caja Renombrada", email: "cashier@example.com" },
      }),
    );
  });

  it("offers a reveal toggle and strength guidance when creating a user", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await user.click(screen.getByRole("button", { name: /Nuevo usuario/ }));
    // Modal moves focus to its first field on the next animation frame; type
    // only after that lands, or the keystrokes race into "Nombre".
    await waitFor(() => expect(screen.getByLabelText(/^Nombre/)).toHaveFocus());

    const password = screen.getByLabelText(/^Contraseña/) as HTMLInputElement;
    expect(password).toHaveAttribute("type", "password");

    await user.type(password, "ClaveSegura123");
    expect(screen.getByText("Fuerte")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Mostrar contraseña" }),
    );

    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("ClaveSegura123");
  });

  it("offers the same toggle on the reset-password field", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await user.click(
      screen.getByRole("button", { name: "Restablecer contraseña de Caja Uno" }),
    );

    const password = screen.getByLabelText(
      /^Nueva contraseña/,
    ) as HTMLInputElement;
    expect(password).toHaveAttribute("type", "password");

    await user.click(
      screen.getByRole("button", { name: "Mostrar contraseña" }),
    );

    expect(password).toHaveAttribute("type", "text");
  });

  it("does not offer Administrador to an admin who is not the primary owner", async () => {
    // Only the primary owner (or a SUPER_ADMIN) may create an ADMIN; the API
    // answers 403 to anyone else, so the option would only fail.
    const previous = currentUserMock.value;
    currentUserMock.value = { ...previous, isPrimaryOwner: false };
    try {
      const user = userEvent.setup();
      render(<UsersPage />);

      await user.click(screen.getByRole("button", { name: /Nuevo usuario/ }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByLabelText("Rol"));
      const options = await screen.findAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual(["Cajero", "Inventario"]);
    } finally {
      currentUserMock.value = previous;
    }
  });

  it("still offers Administrador to a SUPER_ADMIN, who holds no membership flag", async () => {
    const previous = currentUserMock.value;
    currentUserMock.value = {
      ...previous,
      role: "SUPER_ADMIN",
      isPrimaryOwner: false,
    };
    try {
      const user = userEvent.setup();
      render(<UsersPage />);

      await user.click(screen.getByRole("button", { name: /Nuevo usuario/ }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByLabelText("Rol"));
      const options = await screen.findAllByRole("option");
      expect(options.map((option) => option.textContent)).toContain("Administrador");
    } finally {
      currentUserMock.value = previous;
    }
  });

  it("offers only Cajero, Inventario and Administrador when creating a user", async () => {
    // MEMBER is retired (architecture/roles-redesign): existing members were
    // migrated to CASHIER, so the team screen must not mint new ones.
    const user = userEvent.setup();
    render(<UsersPage />);

    await user.click(screen.getByRole("button", { name: /Nuevo usuario/ }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/^Nombre/), "Cajero Uno");
    await user.type(
      within(dialog).getByLabelText(/^Correo/),
      "cajero@example.com",
    );
    await user.type(
      within(dialog).getByLabelText(/^Contraseña/),
      "ClaveSegura123",
    );

    await user.click(within(dialog).getByLabelText("Rol"));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Cajero",
      "Inventario",
      "Administrador",
    ]);
    expect(screen.queryByRole("option", { name: "Miembro" })).toBeNull();

    await user.click(screen.getByRole("option", { name: "Inventario" }));
    await user.click(within(dialog).getByRole("button", { name: "Crear" }));

    await waitFor(() =>
      expect(createUserMock).toHaveBeenCalledWith({
        name: "Cajero Uno",
        email: "cajero@example.com",
        password: "ClaveSegura123",
        role: "INVENTORY_USER",
      }),
    );
  });

  it("opts the selected member into the site assignment dialog", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    expect(screen.queryByTestId("site-assignment-modal")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Sedes de Caja Uno" }));

    expect(screen.getByTestId("site-assignment-modal")).toHaveTextContent(
      "Caja Uno",
    );
  });

  it("offers site assignment only on other members' rows", () => {
    render(<UsersPage />);

    // The signed-in administrator manages everyone else; their own access is
    // organization-wide and is never edited from this list.
    expect(
      screen.queryByRole("button", { name: "Sedes de Admin Principal" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Sedes de Caja Uno" }),
    ).toBeInTheDocument();
  });

  it("renders the role label inside its badge without wrapping or shrinking it", () => {
    render(<UsersPage />);

    const badge = screen.getByText("Cajero");
    expect(badge.textContent).toBe("Cajero");
    expect(badge.className).toContain("whitespace-nowrap");
    expect(badge.className).toContain("shrink-0");
  });

  it("omits the role badge when the API sends no role instead of rendering an icon-only pill", () => {
    // GET /users currently returns users without `role`.
    (usersData as User[]).push({
      id: "user-3",
      email: "norole@example.com",
      name: "Sin Rol",
      active: true,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    } as unknown as User);
    try {
      render(<UsersPage />);

      const row = screen.getByText("Sin Rol").closest("[class~='py-3.5']")!;
      const badges = Array.from(row.querySelectorAll("span")).filter((el) =>
        el.querySelector("svg.lucide-shield"),
      );
      expect(badges).toHaveLength(0);
    } finally {
      usersData.pop();
    }
  });
});
