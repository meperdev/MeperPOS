import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

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

const SUPPLIER_NAME = "Distribuidora Andina";

describe("Suppliers card footer", () => {
  beforeEach(() => {
    window.localStorage.setItem("meperpos:view-mode:suppliers", "grid");
    useSuppliersMock.mockReturnValue({
      data: {
        data: [
          {
            id: "supplier-1",
            name: SUPPLIER_NAME,
            documentNumber: "900123456",
            bank: "Bancolombia",
            accountType: "SAVINGS",
            accountNumber: "12345678901234567890",
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        meta: { total: 1, page: 1, limit: 12, totalPages: 1 },
      },
      isLoading: false,
    });
  });

  afterEach(() => {
    window.localStorage.removeItem("meperpos:view-mode:suppliers");
    cleanup();
  });

  it("renders the copy action frameless, like the delete action, at h-9 w-9", () => {
    render(<SuppliersPage />);

    const copy = screen.getByRole("button", { name: `Copiar cuenta de ${SUPPLIER_NAME}` });
    expect(copy.className).toContain("h-9");
    expect(copy.className).toContain("w-9");
    expect(copy.className).toContain("border-transparent");
    expect(copy.className).toContain("hover:bg-muted");
    expect(copy.className).not.toContain("bg-muted/40");
    expect(copy.className).not.toContain("border-border/60");
    expect(copy.className).toContain("focus-visible:ring-primary/40");
  });

  it("makes the supplier card's edit target a real button named Editar <name>, above its copy control", async () => {
    render(<SuppliersPage />);

    const edit = screen.getByRole("button", { name: `Editar ${SUPPLIER_NAME}` });
    expect(edit.tagName).toBe("BUTTON");
    expect(edit.parentElement!.getAttribute("role")).toBeNull();
    expect(edit.parentElement!.className).toContain("relative");

    const copy = screen.getByRole("button", { name: `Copiar cuenta de ${SUPPLIER_NAME}` });
    expect(copy.className).toContain("relative");
    expect(copy.className).toContain("z-10");

    edit.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("Editar proveedor")).toBeInTheDocument();
  });

  it("gives the supplier table row no tab stop and opens the edit form from its name button", async () => {
    window.localStorage.setItem("meperpos:view-mode:suppliers", "table");
    render(<SuppliersPage />);

    const row = screen.getByRole("button", { name: `Editar ${SUPPLIER_NAME}` }).closest("tr")!;
    expect(row).not.toHaveAttribute("tabindex");

    await userEvent.click(within(row).getByRole("button", { name: `Editar ${SUPPLIER_NAME}` }));
    expect(screen.getByText("Editar proveedor")).toBeInTheDocument();
    window.localStorage.removeItem("meperpos:view-mode:suppliers");
  });

  it("lists Todos first in the status filter and keeps the default selection", () => {
    render(<SuppliersPage />);

    const track = screen.getByText("Estado").parentElement!.querySelector<HTMLElement>('[role="group"]')!;
    const labels = Array.from(track.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Todos", "Activos", "Inactivos"]);
    expect(screen.getByRole("button", { name: "Activos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("hugs its contact lines instead of stretching them to a fixed height", () => {
    render(<SuppliersPage />);

    const edit = screen.getByRole("button", { name: `Editar ${SUPPLIER_NAME}` });
    const card = edit.parentElement as HTMLElement;

    // Same stretch defect as the customer card: the contact block reserved a
    // magic height inside a grid-stretched card that spread its content apart.
    expect(card.className).not.toContain("justify-between");
    expect(card.className).not.toContain("min-h-[4.25rem]");
    expect(card.className).toContain("active:bg-muted/60");
    expect(edit.className).toContain("active:bg-muted/20");
  });

  it("lays the supplier cards out on the shared intrinsic collection grid", () => {    render(<SuppliersPage />);

    const grid = screen.getByRole("button", { name: `Copiar cuenta de ${SUPPLIER_NAME}` }).closest<HTMLElement>(".grid");
    expect(grid!.className).toContain("grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]");
    expect(grid!.className).not.toMatch(/(^|\s)(sm|md|lg|xl):grid-cols/);
  });

  it("keeps the bank name bounded so it never pushes the identity row apart", () => {
    render(<SuppliersPage />);

    // The chip stays short; the account number now lives on its own line below.
    const chip = screen.getByText("Bancolombia");
    expect(chip.className).toContain("shrink-0");
    expect(chip.className).toContain("max-w-[9rem]");
    expect(chip.className).toContain("truncate");

    const left = chip.parentElement!;
    expect(left.className).toContain("min-w-0");
    expect(left.className).toContain("flex-1");
  });
});
