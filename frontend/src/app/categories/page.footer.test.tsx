import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
