import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

/**
 * S4: the skeleton must be shaped like the view the page is actually in, and a
 * fast answer must not flash one. These describe the target behaviour; the page
 * used to paint the row skeleton in cards mode and to paint it on every refetch.
 */

const useSuppliersMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useSuppliers", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useSuppliers: (params: unknown) => useSuppliersMock(params),
    useCreateSupplier: mutation,
    useUpdateSupplier: mutation,
    useDeactivateSupplier: mutation,
    useReactivateSupplier: mutation,
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Error",
}));

import SuppliersPage from "./page";

const LOADING_LABEL = "Cargando proveedores…";

function stubWideViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: true,
      media: "(min-width: 640px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function emptyPage() {
  return {
    data: { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 1 } },
    isLoading: false,
    isFetching: false,
  };
}

describe("Suppliers loading skeleton (S4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubWideViewport();
    useSuppliersMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    useSuppliersMock.mockReset();
    window.localStorage.clear();
    Reflect.deleteProperty(window, "matchMedia");
    cleanup();
  });

  it("paints the card skeleton in cards mode, never the row skeleton", () => {
    window.localStorage.setItem("meperpos:view-mode:suppliers", "grid");

    render(<SuppliersPage />);

    // Deferred: nothing during the first delay, so a fast load never flashes.
    expect(screen.queryByText(LOADING_LABEL)).toBeNull();

    advance(500);

    const status = screen.getByRole("status");
    expect(status.className).toContain("grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]");
    // Table chrome (header band + rows) is the shape this bug reported.
    expect(status.querySelector(".border-b")).toBeNull();
  });

  it("paints the row skeleton in rows mode", () => {
    window.localStorage.setItem("meperpos:view-mode:suppliers", "table");

    render(<SuppliersPage />);
    advance(500);

    const status = screen.getByRole("status");
    expect(status.className).not.toContain("grid-cols-[repeat(auto-fill");
    // Header band plus one band per skeleton row.
    expect(status.querySelectorAll(".border-b")).toHaveLength(1 + 6);
  });

  it("never flashes a skeleton when the records arrive before the delay", () => {
    window.localStorage.setItem("meperpos:view-mode:suppliers", "grid");

    const { rerender } = render(<SuppliersPage />);
    expect(screen.queryByText(LOADING_LABEL)).toBeNull();

    useSuppliersMock.mockReturnValue(emptyPage());
    rerender(<SuppliersPage />);
    advance(1_000);

    expect(screen.queryByText(LOADING_LABEL)).toBeNull();
    expect(screen.getByText("No hay proveedores registrados")).toBeInTheDocument();
  });
});
