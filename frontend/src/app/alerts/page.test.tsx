import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const historyMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useAlertNotifications", () => ({
  useAlertNotifications: (params: unknown) => historyMock(params),
}));

import AlertHistoryPage from "./page";

const item = {
  id: "e1",
  product: { id: "p1", name: "Café molido 500 g", sku: "BEB-003" },
  episode: 2,
  kind: "NOTIFIED" as const,
  failureReason: null,
  createdAt: "2026-11-15T10:00:00.000Z",
};

const page = (overrides: Record<string, unknown> = {}) => ({
  data: {
    data: [item],
    meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  ...overrides,
});

const meta = (overrides: Record<string, unknown> = {}) => ({
  data: {
    data: [item],
    meta: { total: 21, page: 1, limit: 20, totalPages: 2, ...overrides },
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});

describe("AlertHistoryPage", () => {
  afterEach(() => {
    cleanup();
    historyMock.mockReset();
  });

  it("renders the episode with its kind and product", () => {
    historyMock.mockReturnValue(page());

    render(<AlertHistoryPage />);

    expect(screen.getByText("Historial de notificaciones")).toBeInTheDocument();
    expect(screen.getByText("Café molido 500 g")).toBeInTheDocument();
    expect(screen.getByText("Enviada")).toBeInTheDocument();
    expect(screen.getByText(/episodio 2/)).toBeInTheDocument();
  });

  it("shows the failure code when the send failed", () => {
    historyMock.mockReturnValue(
      page({
        data: {
          data: [
            { ...item, kind: "FAILED", failureReason: "provider_rejected" },
          ],
          meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        },
      }),
    );

    render(<AlertHistoryPage />);

    expect(screen.getByText("Fallida")).toBeInTheDocument();
    expect(screen.getByText(/provider_rejected/)).toBeInTheDocument();
  });

  it("asks the server for the selected kind and resets the page", async () => {
    historyMock.mockReturnValue(meta());

    render(<AlertHistoryPage />);

    expect(historyMock).toHaveBeenLastCalledWith({ page: 1, limit: 20 });
    await userEvent.click(screen.getByRole("button", { name: "Fallidas" }));
    expect(historyMock).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
      kind: "FAILED",
    });
  });

  it("shows the empty state without episodes", () => {
    historyMock.mockReturnValue(
      page({
        data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } },
      }),
    );

    render(<AlertHistoryPage />);

    expect(screen.getByText("Sin notificaciones todavía")).toBeInTheDocument();
  });

  it("shows the error state with a retry", async () => {
    const refetch = vi.fn();
    historyMock.mockReturnValue(page({ isError: true, data: undefined, refetch }));

    render(<AlertHistoryPage />);

    expect(
      screen.getByText("No se pudo cargar el historial de notificaciones."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalled();
  });
});
