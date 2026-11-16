import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const useProfileMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => useProfileMock(),
  useUpdateProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangePassword: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Ana Admin", email: "ana@negocio.com", role: "ADMIN" },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import ProfilePage from "./page";

afterEach(() => {
  cleanup();
  useProfileMock.mockReset();
});

describe("Perfil loading", () => {
  it("paints the profile's shape instead of a spinner while it loads", () => {
    useProfileMock.mockReturnValue({ data: undefined, isLoading: true });

    render(<ProfilePage />);

    expect(screen.getByText("Cargando perfil…")).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    // Summary card plus the two credential/personal-data cards.
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(2);
  });
});
