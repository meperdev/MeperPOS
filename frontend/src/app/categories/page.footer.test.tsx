import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

const useCategoriesMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useCategories", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useCategories: (params: unknown) => useCategoriesMock(params),
    useCreateCategory: mutation,
    useUpdateCategory: mutation,
    useDeleteCategory: mutation,
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

import CategoriesPage from "./page";

const CATEGORY_NAME = "Lácteos y derivados de origen animal";

describe("Categories card layout", () => {
  beforeEach(() => {
    window.localStorage.setItem("meperpos:view-mode:categories", "grid");
    useCategoriesMock.mockReturnValue({
      data: {
        data: [
          {
            id: "category-1",
            name: CATEGORY_NAME,
            description: null,
            defaultTaxRate: 19,
            productCount: 12,
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        meta: { total: 1, page: 1, limit: 12, totalPages: 1 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    window.localStorage.removeItem("meperpos:view-mode:categories");
    cleanup();
  });

  it("uses the shared intrinsic collection grid", () => {
    render(<CategoriesPage />);

    const card = screen.getByRole("heading", { name: CATEGORY_NAME }).closest<HTMLElement>("div.group");
    expect(card!.parentElement!.className).toContain("grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]");
    expect(card!.parentElement!.className).not.toMatch(/(^|\s)(sm|md|lg|xl):grid-cols/);
  });

  it("drops the pencil: the card's edit target is a real button, above its nested delete and count controls", async () => {
    render(<CategoriesPage />);

    const edit = screen.getByRole("button", { name: `Editar ${CATEGORY_NAME}` });
    expect(edit.tagName).toBe("BUTTON");
    const card = edit.parentElement!;
    expect(card.getAttribute("role")).toBeNull();
    const nestedLabels = Array.from(card.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
    expect(nestedLabels).toEqual([
      `Editar ${CATEGORY_NAME}`,
      `Eliminar ${CATEGORY_NAME}`,
      `Ver productos de ${CATEGORY_NAME}`,
    ]);
    for (const control of [`Eliminar ${CATEGORY_NAME}`, `Ver productos de ${CATEGORY_NAME}`]) {
      expect(screen.getByRole("button", { name: control }).className).toContain("z-10");
    }

    edit.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("Editar categoría")).toBeInTheDocument();
  });

  it("gives the category table row no tab stop and opens the edit form from its name button", async () => {
    window.localStorage.setItem("meperpos:view-mode:categories", "table");
    render(<CategoriesPage />);

    const row = screen.getByRole("button", { name: `Editar ${CATEGORY_NAME}` }).closest("tr")!;
    expect(row).not.toHaveAttribute("tabindex");

    await userEvent.click(within(row).getByRole("button", { name: `Editar ${CATEGORY_NAME}` }));
    expect(screen.getByText("Editar categoría")).toBeInTheDocument();
    window.localStorage.removeItem("meperpos:view-mode:categories");
  });

  it("lets the card shrink and keeps the count and tax chips from wrapping inside the footer", () => {
    render(<CategoriesPage />);

    const card = screen.getByRole("heading", { name: CATEGORY_NAME }).closest<HTMLElement>("div.group");
    expect(card!.className).toContain("min-w-0");

    const countButton = screen.getByRole("button", { name: `Ver productos de ${CATEGORY_NAME}` });
    expect(countButton.className).toContain("whitespace-nowrap");
    expect(countButton.className).toContain("shrink-0");

    const taxChip = screen.getByText("19%");
    expect(taxChip.className).toContain("whitespace-nowrap");
    expect(taxChip.className).toContain("shrink-0");

    const footer = countButton.parentElement!;
    expect(footer.className).toContain("flex-wrap");
  });
});
