import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Pagination } from "@/components/ui/Pagination";

afterEach(() => {
  cleanup();
});

describe("Pagination placement", () => {
  it("pins to the bottom of a page column by default", () => {
    render(
      <Pagination currentPage={1} totalPages={3} onPageChange={vi.fn()} totalItems={30} pageSize={10} />,
    );

    const footer = screen.getByText(/Mostrando/).closest<HTMLElement>("div")!;
    expect(footer.className).toContain("mt-auto");
    expect(footer.className).toContain("sticky");
    // S1.3: below lg the bar parks above the fixed tab bar instead of under it.
    expect(footer.className).toContain(
      "bottom-[calc(var(--mobile-tabbar)+var(--safe-bottom))]",
    );
    expect(footer.className).toContain("lg:bottom-0");
    expect(footer.className).toContain("z-10");
    expect(footer.className).toContain("bg-background");
    expect(footer.className).toContain("border-t");
    expect(footer.className).toContain("border-border");
    expect(footer.className).toContain("pt-3");
  });

  it("stays inline when pinned is false, as inside a modal", () => {
    render(
      <Pagination
        currentPage={1}
        totalPages={3}
        onPageChange={vi.fn()}
        totalItems={30}
        pageSize={10}
        pinned={false}
      />,
    );

    const footer = screen.getByText(/Mostrando/).closest<HTMLElement>("div")!;
    expect(footer.className).not.toContain("sticky");
    expect(footer.className).not.toContain("mt-auto");
  });

  it("still renders nothing when there are no results", () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={0} onPageChange={vi.fn()} totalItems={0} pageSize={10} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Pagination pinned safe area", () => {
  it("clears the home indicator only when pinned", () => {
    const { unmount } = render(
      <Pagination currentPage={1} totalPages={3} onPageChange={vi.fn()} totalItems={30} pageSize={10} />,
    );
    const pinned = screen.getByText(/Mostrando/).closest<HTMLElement>("div")!;
    expect(pinned).toHaveClass("pb-[max(0.75rem,var(--safe-bottom))]");
    expect(pinned).toHaveClass("pt-3");
    expect(pinned).not.toHaveClass("py-3");
    unmount();

    render(
      <Pagination currentPage={1} totalPages={3} onPageChange={vi.fn()} totalItems={30} pageSize={10} pinned={false} />,
    );
    expect(screen.getByText(/Mostrando/).closest("div")).not.toHaveClass("pb-[max(0.75rem,var(--safe-bottom))]");
  });

  it("keeps the desktop bar flush with the viewport bottom", () => {
    render(
      <Pagination currentPage={1} totalPages={3} onPageChange={vi.fn()} totalItems={30} pageSize={10} />,
    );

    const pinned = screen.getByText(/Mostrando/).closest<HTMLElement>("div")!;
    // `lg:bottom-0` restores the desktop position; the mobile offset is the
    // only one that knows about the tab bar.
    expect(pinned.className).toContain("lg:bottom-0");
    expect(pinned.className).not.toMatch(/(^|\s)bottom-0(\s|$)/);
  });
});

describe("Pagination compact container layout", () => {
  it("is a size container, keeps the count compact and icon-first buttons below @md", () => {
    render(
      <Pagination currentPage={1} totalPages={17} onPageChange={vi.fn()} totalItems={152} pageSize={9} />,
    );
    const root = screen.getByText(/Mostrando/).closest<HTMLElement>("div")!;
    expect(root).toHaveClass("@container");

    const compactCount = screen.getByText("1–9 de 152");
    expect(compactCount).toHaveClass("@md:hidden", "text-muted-foreground", "tabular-nums");

    for (const name of ["Anterior", "Siguiente"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass("h-10", "w-10", "@md:h-9", "@md:w-auto");
      // The visible word only shows from @md up; the accessible name stays the same.
      expect(button.querySelector("span")).toHaveClass("sr-only", "@md:not-sr-only");
    }

    expect(screen.getByText("1 / 17")).toHaveClass("h-10", "@md:h-9");
  });
});

describe("Pagination Spanish plural labels", () => {
  it("pluralises the item label by default", () => {
    render(<Pagination currentPage={1} totalPages={1} onPageChange={vi.fn()} totalItems={9} itemLabel="producto" />);
    expect(screen.getByText(/productos/).closest("p")).toHaveTextContent("9 productos");
  });

  it("uses itemLabelPlural when the rule would be wrong", () => {
    const { unmount } = render(
      <Pagination currentPage={1} totalPages={1} onPageChange={vi.fn()} totalItems={9} itemLabel="orden" itemLabelPlural="órdenes" />,
    );
    expect(screen.getByText(/órdenes/).closest("p")).toHaveTextContent("9 órdenes");
    unmount();

    render(<Pagination currentPage={1} totalPages={1} onPageChange={vi.fn()} totalItems={1} itemLabel="orden" itemLabelPlural="órdenes" />);
    expect(screen.getByText(/orden/).closest("p")).toHaveTextContent("1 orden");
  });
});
