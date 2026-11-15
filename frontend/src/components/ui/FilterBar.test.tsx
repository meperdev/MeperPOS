import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FilterBar, FilterGroup, FilterOptionButton } from "@/components/ui/FilterBar";

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

  it("wraps intrinsically instead of stacking at a fixed width", () => {
    renderBar();

    const row = screen.getByRole("searchbox").parentElement!.parentElement!;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).toContain("items-center");
    expect(row.className).not.toContain("flex-col");
    expect(row.className).not.toMatch(/@3xl:/);
  });

  it("gives the search a 14rem floor and nearly all leftover width on a shared row", () => {
    renderBar();

    const searchWrapper = screen.getByRole("searchbox").parentElement!;
    expect(searchWrapper.className).toContain("min-w-[14rem]");
    expect(searchWrapper.className).toContain("flex-[999_1_16rem]");
  });

  it("lets the controls grow to the full row once they wrap alone", () => {
    renderBar();

    const controls = screen.getByText("Control").parentElement!;
    expect(controls.className).toContain("flex-wrap");
    expect(controls.className).toContain("flex-[1_1_auto]");
    expect(controls.className).toContain("min-w-0");
  });
});

describe("FilterGroup track", () => {
  function renderGroup(innerClassName?: string) {
    render(
      <FilterGroup label="Estado" innerClassName={innerClassName}>
        <FilterOptionButton active>Todos</FilterOptionButton>
        <FilterOptionButton>Activos</FilterOptionButton>
      </FilterGroup>,
    );
    return screen.getByText("Todos").parentElement as HTMLElement;
  }

  it("is a borderless muted track with symmetric p-0.5 padding", () => {
    const track = renderGroup();

    expect(track.className).toContain("bg-muted");
    expect(track.className).toContain("p-0.5");
    expect(track.className).not.toMatch(/\bborder\b/);
    expect(track.className).not.toContain("bg-muted/40");
  });

  it("clips overflowing text segments by default", () => {
    expect(renderGroup().className).toContain("overflow-x-auto");
  });
});
