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
    expect(footer.className).toContain("bottom-0");
    expect(footer.className).toContain("z-10");
    expect(footer.className).toContain("bg-background");
    expect(footer.className).toContain("border-t");
    expect(footer.className).toContain("border-border");
    expect(footer.className).toContain("py-3");
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
