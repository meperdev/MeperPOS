import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const replaceMock = vi.fn();
const useSalesMock = vi.fn();

let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/Badge", () => ({
  Badge: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/Card", () => ({
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <section>{children}</section> : null,
}));

vi.mock("@/hooks/useSales", () => ({
  useSales: (params?: unknown) => useSalesMock(params),
}));

vi.mock("@/hooks/useReceipt", () => ({
  downloadReceiptPdf: vi.fn(),
  openReceiptPdf: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "admin-1", role: "ADMIN", name: "Admin", email: "admin@example.com" },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Error",
}));

vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>(
    "@/lib/utils",
  );
  return {
    ...actual,
    formatCurrency: (value: number) => `$${value}`,
    formatDateTime: (value: string) => value,
    getBogotaDateInputValue: () => "2026-03-24",
    shiftDateInputValue: () => "2026-03-18",
  };
});

vi.mock("@/lib/chipStyles", () => ({
  chipStyles: { primary: "chip-primary" },
}));

import SalesPage from "./page";

describe("Sales page deep-link behavior (#24)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    useSalesMock.mockReturnValue({
      data: {
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      },
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the customer filter badge and requests sales with customerId", () => {
    currentSearchParams = new URLSearchParams([
      ["customerId", "customer-1"],
      ["customerName", "Ana Perez"],
    ]);

    render(<SalesPage />);

    expect(useSalesMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "customer-1" }),
    );
    expect(screen.getByText(/Historial de cliente/i)).toBeTruthy();
    expect(screen.getByText(/Ana Perez/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Quitar filtro/i })).toBeTruthy();
  });

  it("clears the customer deep-link filter back to /sales", async () => {
    currentSearchParams = new URLSearchParams([
      ["customerId", "customer-1"],
      ["customerName", "Ana Perez"],
    ]);

    render(<SalesPage />);

    await userEvent.click(screen.getByRole("button", { name: /Quitar filtro/i }));

    expect(replaceMock).toHaveBeenCalledWith("/sales");
  });
});
