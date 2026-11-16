import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const historyMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useAlertNotifications", () => ({
  useAlertNotifications: (params: unknown) => historyMock(params),
}));

import AlertHistoryPage from "./page";

afterEach(() => {
  cleanup();
  historyMock.mockReset();
});

describe("Alertas loading", () => {
  it("paints the notification list's shape instead of a spinner while it loads", () => {
    historyMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<AlertHistoryPage />);

    expect(screen.getByText("Cargando historial…")).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
