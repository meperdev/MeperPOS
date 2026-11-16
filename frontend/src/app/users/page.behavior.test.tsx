import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { User } from "@/types";

const {
  createUserMutateAsyncMock,
  updateUserMutateAsyncMock,
  deleteUserMutateAsyncMock,
  toggleUserActiveMutateAsyncMock,
  resetPasswordMutateAsyncMock,
  toastSuccessMock,
  toastErrorMock,
  usersData,
} = vi.hoisted(() => ({
  createUserMutateAsyncMock: vi.fn(),
  updateUserMutateAsyncMock: vi.fn(),
  deleteUserMutateAsyncMock: vi.fn(),
  toggleUserActiveMutateAsyncMock: vi.fn(),
  resetPasswordMutateAsyncMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  usersData: [
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
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useUsers", () => ({
  useUsers: () => ({ data: usersData, isLoading: false }),
  useCreateUser: () => ({ mutateAsync: createUserMutateAsyncMock, isPending: false }),
  useUpdateUser: () => ({ mutateAsync: updateUserMutateAsyncMock, isPending: false }),
  useDeleteUser: () => ({ mutateAsync: deleteUserMutateAsyncMock, isPending: false }),
  useToggleUserActive: () => ({ mutateAsync: toggleUserActiveMutateAsyncMock, isPending: false }),
  useResetUserPassword: () => ({ mutateAsync: resetPasswordMutateAsyncMock, isPending: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "admin-1", role: "ADMIN", name: "Admin Principal", email: "admin@example.com" },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Error",
}));

import UsersPage from "@/components/users/UsersManagementPage";

describe("Users page centralized admin behavior (#27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createUserMutateAsyncMock.mockResolvedValue({} as never);
    updateUserMutateAsyncMock.mockResolvedValue({} as never);
    deleteUserMutateAsyncMock.mockResolvedValue({} as never);
    toggleUserActiveMutateAsyncMock.mockResolvedValue({} as never);
    resetPasswordMutateAsyncMock.mockResolvedValue({} as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps self-protection while exposing admin lifecycle actions for other users", () => {
    render(<UsersPage />);

    const deactivateButtons = screen.getAllByRole("button", { name: /Desactivar/i });

    expect(deactivateButtons).toHaveLength(2);
    expect((deactivateButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((deactivateButtons[1] as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: /Editar usuario Admin Principal/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Restablecer contraseña de Admin Principal/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Eliminar usuario Admin Principal/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Editar usuario Caja Uno/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Restablecer contraseña de Caja Uno/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Eliminar usuario Caja Uno/i })).not.toBeNull();
  });

  it("updates another user through the centralized users flow", async () => {
    const user = userEvent.setup();

    render(<UsersPage />);

    await user.click(screen.getByRole("button", { name: /Editar usuario Caja Uno/i }));
    const nameInput = await screen.findByLabelText(/Nombre/i);
    const emailInput = await screen.findByLabelText(/Correo/i);

    await user.clear(nameInput);
    await user.type(nameInput, "Caja Central");
    await user.clear(emailInput);
    await user.type(emailInput, "central@example.com");
    // Select renders the role as a trigger <button> named by its "Rol" label; open it and pick the option.
    await user.click(screen.getByRole("button", { name: /Rol/i }));
    await user.click(screen.getByText("Inventario"));
    await user.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    expect(updateUserMutateAsyncMock).toHaveBeenCalledWith({
      id: "user-2",
      data: {
        name: "Caja Central",
        email: "central@example.com",
        role: "INVENTORY_USER",
      },
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Usuario actualizado correctamente");
  });
});
