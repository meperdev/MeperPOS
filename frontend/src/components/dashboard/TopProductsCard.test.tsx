import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { TopProductsCard } from "./TopProductsCard";
import type { TopSellingProduct } from "@/types";

const useTopSellingProductsMock = vi.fn();

vi.mock("@/hooks/useReports", () => ({
  useTopSellingProducts: (startDate: string, endDate: string, limit: number) =>
    useTopSellingProductsMock(startDate, endDate, limit),
}));

function product(index: number): TopSellingProduct {
  return {
    productId: `p-${index}`,
    productName: `Producto ${index}`,
    quantity: index * 10,
    total: index * 1000,
    stock: 5,
  };
}

describe("TopProductsCard (ranked list)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopSellingProductsMock.mockReturnValue({
      data: { data: [1, 2, 3, 4, 5, 6].map(product) },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("requests the top five for the given window", () => {
    render(<TopProductsCard startDate="2026-08-16" endDate="2026-08-22" />);

    expect(useTopSellingProductsMock).toHaveBeenCalledWith(
      "2026-08-16",
      "2026-08-22",
      5,
    );
  });

  it("renders at most five ranked rows with name and quantity sold", () => {
    render(<TopProductsCard startDate="2026-08-16" endDate="2026-08-22" />);

    const rows = screen.getAllByTestId("top-product-row");
    expect(rows).toHaveLength(5);

    const first = within(rows[0]);
    expect(first.getByTestId("top-product-rank").textContent).toBe("1");
    expect(first.getByText("Producto 1")).toBeTruthy();
    expect(first.getByTestId("top-product-quantity").textContent).toBe("10");
  });

  it("sets the name and unit count one step above the old 13px, with roomier rows", () => {
    render(<TopProductsCard startDate="2026-08-16" endDate="2026-08-22" />);

    const rows = screen.getAllByTestId("top-product-row");
    const row = rows[0];
    expect(row.className).toContain("text-sm");
    expect(row.className).toContain("py-1");
    expect(within(row).getByTestId("top-product-rank").className).toContain("text-xs");

    const list = row.parentElement as HTMLElement;
    expect(list.className.split(" ")).toContain("space-y-1");

    const quantity = within(row).getByTestId("top-product-quantity");
    const units = quantity.parentElement as HTMLElement;
    expect(units.className).toContain("text-sm");
    expect(units.className).toContain("font-semibold");
    expect(units.className).toContain("tabular-nums");
  });

  it("renders no image element (the endpoint returns none)", () => {
    const { container } = render(
      <TopProductsCard startDate="2026-08-16" endDate="2026-08-22" />,
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("shows an empty state when there are no products", () => {
    useTopSellingProductsMock.mockReturnValue({ data: { data: [] } });

    render(<TopProductsCard startDate="2026-08-16" endDate="2026-08-22" />);

    expect(screen.getByText("Sin ventas en el período")).toBeTruthy();
    expect(screen.queryAllByTestId("top-product-row")).toHaveLength(0);
  });
});
