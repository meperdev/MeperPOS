import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FilterBar } from "@/components/ui/FilterBar";

afterEach(() => {
  cleanup();
});

function renderBar() {
  const { container } = render(
    <FilterBar
      searchValue=""
      onSearchChange={vi.fn()}
      filterControls={<span>Control</span>}
    />,
  );
  return { root: container.firstElementChild as HTMLElement };
}

describe("FilterBar container layout", () => {
  it("is a size container so its row adapts to its own width, not the viewport", () => {
    const { root } = renderBar();

    expect(root.className).toContain("@container");
    expect(root.className).not.toMatch(/\bsm:flex-row\b/);
  });

  it("stacks the search row until the container reaches 48rem (@3xl)", () => {
    renderBar();

    const row = screen.getByRole("searchbox").parentElement!.parentElement!;
    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("gap-3");
    expect(row.className).toContain("@3xl:flex-row");
    expect(row.className).toContain("@3xl:items-center");
  });

  it("lets the search field flex only once the row is horizontal", () => {
    renderBar();

    const searchWrapper = screen.getByRole("searchbox").parentElement!;
    expect(searchWrapper.className).toContain("w-full");
    expect(searchWrapper.className).toContain("@3xl:min-w-[14rem]");
    expect(searchWrapper.className).toContain("@3xl:flex-1");
  });

  it("wraps controls in a group that only shrinks to content in the wide layout", () => {
    renderBar();

    const controls = screen.getByText("Control").parentElement!;
    expect(controls.className).toContain("flex-wrap");
    expect(controls.className).toContain("w-full");
    expect(controls.className).toContain("@3xl:w-auto");
  });
});
