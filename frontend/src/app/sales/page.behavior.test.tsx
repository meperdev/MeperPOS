import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("keeps cached sales visible when a background refetch fails", () => {
    useSalesMock.mockReturnValue({
      data: {
        data: [
          {
            id: "sale-1",
            saleNumber: 42,
            status: "PAID",
            total: 100,
            createdAt: "2026-03-24T10:00:00Z",
            customer: { name: "Ana Perez" },
            payments: [],
            financed: false,
            user: { name: "Admin" },
          },
        ],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      },
      isLoading: false,
      isError: true,
      error: new Error("network down"),
      refetch: vi.fn(),
    });

    render(<SalesPage />);

    expect(screen.getAllByText("#42").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("offers no filter-bar Limpiar: the Todas period option already resets the dates", async () => {
    currentSearchParams = new URLSearchParams();

    render(<SalesPage />);

    await userEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.queryByRole("button", { name: "Limpiar" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(screen.getByRole("button", { name: "Todas" }).getAttribute("aria-pressed")).toBe("true");
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

describe("Sales table width (min-w only with rows)", () => {
  const sale = {
    id: "sale-1",
    saleNumber: 42,
    status: "PAID",
    total: 100,
    createdAt: "2026-03-24T10:00:00Z",
    customer: { name: "Ana Perez" },
    payments: [],
    financed: false,
    user: { name: "Admin" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    window.localStorage.setItem("meperpos:view-mode:sales", "table");
    // The table view measures its list height; jsdom has no ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    window.localStorage.removeItem("meperpos:view-mode:sales");
    vi.unstubAllGlobals();
    cleanup();
  });

  it("enforces the 680px minimum only when the table has rows", () => {
    useSalesMock.mockReturnValue({
      data: { data: [sale], meta: { total: 1, page: 1, limit: 10, totalPages: 1 } },
      isLoading: false,
    });

    render(<SalesPage />);

    expect(screen.getByRole("table").className).toContain("min-w-[680px]");
  });

  it("does not force a minimum width on the empty state", () => {
    useSalesMock.mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } },
      isLoading: false,
    });

    render(<SalesPage />);

    expect(screen.getByRole("table").className).not.toContain("min-w-[680px]");
    expect(screen.getAllByText("No hay ventas registradas").length).toBeGreaterThan(0);
  });
});

describe("Sales rows keep dates out of tabular figures (S11/D7)", () => {
  const sale = {
    id: "sale-1",
    saleNumber: 42,
    status: "PAID",
    total: 100,
    createdAt: "2026-03-24T10:00:00Z",
    customer: { name: "Ana Perez" },
    payments: [],
    financed: false,
    user: { name: "Admin" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    window.localStorage.setItem("meperpos:view-mode:sales", "table");
    // The table view measures its list height; jsdom has no ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    window.localStorage.removeItem("meperpos:view-mode:sales");
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the date cell without tabular-nums while the total keeps it", () => {
    useSalesMock.mockReturnValue({
      data: { data: [sale], meta: { total: 1, page: 1, limit: 10, totalPages: 1 } },
      isLoading: false,
    });

    render(<SalesPage />);

    const table = within(screen.getByRole("table"));

    const dateCell = table
      .getAllByText("2026-03-24T10:00:00Z")[0]
      .closest("td");
    expect(dateCell).not.toBeNull();
    expect(dateCell!.className).not.toContain("tabular-nums");
    // Right alignment stays; only the equal-width digits go away.
    expect(dateCell!.className).toContain("whitespace-nowrap");

    expect(table.getByText("$100").className).toContain("tabular-nums");
  });
});

describe("Sales open their detail by clicking the card or row (no Detalle button)", () => {
  const sale = {
    id: "sale-1",
    saleNumber: 42,
    status: "COMPLETED",
    total: 100,
    subtotal: 100,
    tax: 0,
    createdAt: "2026-03-24T10:00:00Z",
    customer: { name: "Ana Perez" },
    payments: [],
    items: [],
    financed: false,
    user: { name: "Admin" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    useSalesMock.mockReturnValue({
      data: { data: [sale], meta: { total: 1, page: 1, limit: 10, totalPages: 1 } },
      isLoading: false,
    });
  });

  afterEach(() => {
    window.localStorage.removeItem("meperpos:view-mode:sales");
    vi.unstubAllGlobals();
    cleanup();
  });

  it("drops the Detalle button from the card and opens the detail from the card itself", async () => {
    window.localStorage.setItem("meperpos:view-mode:sales", "grid");
    render(<SalesPage />);

    expect(screen.queryByRole("button", { name: /^Detalle$/ })).toBeNull();
    const card = screen.getAllByRole("button", { name: "Ver detalle de venta 42" })[0];
    expect(card).toHaveAttribute("tabindex", "0");
    card.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("Productos de la venta")).toBeTruthy();
  });

  it("sits the payment method in the detail tile grid instead of a full-width row", async () => {
    window.localStorage.setItem("meperpos:view-mode:sales", "grid");
    useSalesMock.mockReturnValue({
      data: {
        data: [{ ...sale, payments: [{ method: "CARD", amount: 100 }] }],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      },
      isLoading: false,
    });
    render(<SalesPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Ver detalle de venta 42" })[0]);

    const paymentTile = screen.getAllByText("Método de pago").at(-1)!.parentElement!;
    const clientTile = screen.getAllByText("Cliente").at(-1)!.parentElement!;
    expect(paymentTile.parentElement).toBe(clientTile.parentElement);
    expect(paymentTile.parentElement!.className).toContain("sm:grid-cols-3");
    expect(paymentTile.className).not.toContain("sm:col-span-4");
  });

  it("drops the eye button from the table row; the row opens the detail", async () => {
    window.localStorage.setItem("meperpos:view-mode:sales", "table");
    render(<SalesPage />);

    const rows = screen.getAllByRole("button", { name: "Ver detalle de venta 42" });
    expect(rows.some((row) => row.tagName === "TR")).toBe(true);
    for (const row of rows) {
      expect(row.querySelector('[aria-label="Ver detalle de venta 42"]')).toBeNull();
    }
  });
});
