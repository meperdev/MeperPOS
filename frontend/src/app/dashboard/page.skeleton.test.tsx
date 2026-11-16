import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const useDashboardMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useReports", () => ({
  useDashboard: () => useDashboardMock(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Ana Admin", role: "ADMIN" } }),
}));

import DashboardPage from "./page";

afterEach(() => {
  cleanup();
  useDashboardMock.mockReset();
});

describe("Panel loading", () => {
  it("paints the panel's shape instead of a spinner while it loads", () => {
    useDashboardMock.mockReturnValue({ data: undefined, isLoading: true });

    render(<DashboardPage />);

    expect(screen.getByText("Cargando panel…")).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    // Metric strip, revenue block and the latest-sales list, all as placeholders.
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(2);
  });
});
