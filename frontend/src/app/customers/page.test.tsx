import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Customer } from "@/types";

const useCustomersMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/hooks/useCustomers", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useCustomers: (params: unknown) => useCustomersMock(params),
    useCreateCustomer: mutation,
    useUpdateCustomer: mutation,
    useDeleteCustomer: mutation,
  };
});

vi.mock("@/hooks/useBusinessModules", () => ({
  useVehiclesModule: () => ({ data: { enabled: false } }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Error",
}));

import CustomersPage from "./page";

const CUSTOMER_NAME = "Cliente Smoke";
const CUSTOMER_ID = "customer-1";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    name: CUSTOMER_NAME,
    documentType: "CC",
    documentNumber: "SMOKE005123",
    email: "asasas@gmail.com",
    phone: null,
    address: null,
    referencia: null,
    placaMoto: null,
    segment: "OCCASIONAL",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function stubWideViewport(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches,
      media: "(min-width: 640px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe("Customers collection on a phone (S3.1, S3.3)", () => {
  beforeEach(() => {
    useCustomersMock.mockReturnValue({
      data: {
        data: [makeCustomer()],
        meta: { total: 1, page: 1, limit: 12, totalPages: 1 },
      },
      isLoading: false,
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, "matchMedia");
    cleanup();
  });

  it("renders cards on a phone even with a persisted table preference", () => {
    stubWideViewport(false);
    window.localStorage.setItem("meperpos:view-mode:customers", "table");

    render(<CustomersPage />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: `Editar ${CUSTOMER_NAME}` })).toBeTruthy();
    // The stored preference stays as it was; it is honoured again at sm.
    expect(window.localStorage.getItem("meperpos:view-mode:customers")).toBe("table");
  });

  it("keeps the persisted table on a wide viewport", () => {
    stubWideViewport(true);
    window.localStorage.setItem("meperpos:view-mode:customers", "table");

    render(<CustomersPage />);

    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("hugs its contact lines instead of stretching them to a fixed height", () => {
    window.localStorage.setItem("meperpos:view-mode:customers", "grid");

    render(<CustomersPage />);

    const card = screen.getByRole("button", { name: `Editar ${CUSTOMER_NAME}` })
      .parentElement as HTMLElement;

    // The gap came from a grid-stretched card that spread its content apart and
    // reserved a magic min height for the contact block.
    expect(card.className).not.toContain("justify-between");
    expect(card.className).not.toContain("min-h-[4.25rem]");
    expect(card.className).not.toContain("flex-1");
  });

  it("shows a pressed state on the card's tap target", () => {
    window.localStorage.setItem("meperpos:view-mode:customers", "grid");

    render(<CustomersPage />);

    const card = screen.getByRole("button", { name: `Editar ${CUSTOMER_NAME}` })
      .parentElement as HTMLElement;
    expect(card.className).toContain("active:bg-muted/60");
    expect(screen.getByRole("button", { name: `Editar ${CUSTOMER_NAME}` }).className).toContain(
      "active:bg-muted/20",
    );
  });
});
