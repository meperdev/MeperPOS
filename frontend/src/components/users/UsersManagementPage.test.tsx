import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { User } from "@/types";

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
  useCreateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useToggleUserActive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResetUserPassword: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "admin-1", role: "ADMIN", name: "Admin Principal", email: "admin@example.com" },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Error",
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

  it("offers a reveal toggle and strength guidance when creating a user", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await user.click(screen.getByRole("button", { name: /Nuevo usuario/ }));

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
