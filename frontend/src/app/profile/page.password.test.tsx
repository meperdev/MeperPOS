import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const changePasswordMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({
    data: { id: "user-1", name: "Ana Admin", email: "ana@negocio.com" },
    isLoading: false,
  }),
  useUpdateProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangePassword: () => ({ mutateAsync: changePasswordMock, isPending: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Ana Admin", email: "ana@negocio.com", role: "ADMIN" },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

import ProfilePage from "./page";

afterEach(() => {
  cleanup();
  changePasswordMock.mockReset();
  toastErrorMock.mockReset();
});

describe("Perfil, contraseñas", () => {
  it("gives every password field its own show/hide toggle", () => {
    render(<ProfilePage />);

    expect(
      screen.getAllByRole("button", { name: "Mostrar contraseña" }),
    ).toHaveLength(3);
    expect(
      screen.getByLabelText(/^Contraseña actual/i, { selector: "input" }),
    ).toHaveAttribute("type", "password");
    expect(
      screen.getByLabelText(/^Nueva contraseña/i, { selector: "input" }),
    ).toHaveAttribute("type", "password");
    expect(
      screen.getByLabelText(/^Confirmar nueva contraseña/i, { selector: "input" }),
    ).toHaveAttribute("type", "password");
  });

  it("reveals only the field whose toggle was pressed", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getAllByRole("button", { name: "Mostrar contraseña" })[1]);

    expect(
      screen.getByLabelText(/^Nueva contraseña/i, { selector: "input" }),
    ).toHaveAttribute("type", "text");
    expect(
      screen.getByLabelText(/^Contraseña actual/i, { selector: "input" }),
    ).toHaveAttribute("type", "password");
  });

  it("shows the strength meter only on the new password", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    // One live region, on the field that creates a password.
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);

    await user.type(
      screen.getByLabelText(/^Nueva contraseña/i, { selector: "input" }),
      "Password123!",
    );

    expect(screen.getByText("Fuerte")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/^Contraseña actual/i, { selector: "input" }),
      "abc",
    );

    expect(screen.getByText("Fuerte")).toBeInTheDocument();
    expect(screen.queryByText("Débil")).not.toBeInTheDocument();
  });

  it("still refuses to submit a password shorter than 10 characters", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.type(
      screen.getByLabelText(/^Contraseña actual/i, { selector: "input" }),
      "ClaveActual1",
    );
    await user.type(
      screen.getByLabelText(/^Nueva contraseña/i, { selector: "input" }),
      "Password1",
    );
    await user.type(
      screen.getByLabelText(/^Confirmar nueva contraseña/i, { selector: "input" }),
      "Password1",
    );

    await user.click(
      screen.getByRole("button", { name: "Actualizar contraseña" }),
    );

    expect(changePasswordMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "La contraseña debe tener al menos 10 caracteres",
    );
  });
});
