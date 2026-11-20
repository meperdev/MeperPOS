import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CollectionSkeleton } from "./CollectionSkeleton";
import { COLLECTION_GRID_CLASSES } from "./collectionGrid";

afterEach(cleanup);

describe("CollectionSkeleton", () => {
  it("paints a card grid on the same grid the real cards use when the page is in cards mode", () => {
    render(<CollectionSkeleton viewMode="grid" label="Cargando proveedores…" />);

    const status = screen.getByRole("status");
    for (const part of COLLECTION_GRID_CLASSES.split(" ")) {
      expect(status.className).toContain(part);
    }
    // No table chrome: a header band would be the rows skeleton the user saw.
    expect(status.querySelector(".border-b")).toBeNull();
    expect(screen.getByText("Cargando proveedores…")).toBeInTheDocument();
  });

  it("paints a table with the real column count when the page is in rows mode", () => {
    render(<CollectionSkeleton viewMode="table" columns={6} rows={4} label="Cargando órdenes…" />);

    const status = screen.getByRole("status");
    expect(status.className).not.toContain("grid-cols-[repeat(auto-fill");
    expect(status.querySelectorAll(".border-b")).toHaveLength(1 + 4);
    expect(status.querySelectorAll(".border-b")[0].children).toHaveLength(6);
  });

  it("uses the product grid when the page asks for it", () => {
    render(<CollectionSkeleton viewMode="grid" gridClassName="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]" />);

    expect(screen.getByRole("status").className).toContain("minmax(10rem,1fr)");
  });

  it("switches shape with the view mode, not with a second component", () => {
    const { rerender } = render(<CollectionSkeleton viewMode="grid" />);
    expect(screen.getByRole("status").className).toContain("grid-cols-[repeat(auto-fill");

    rerender(<CollectionSkeleton viewMode="table" />);
    expect(screen.getByRole("status").className).not.toContain("grid-cols-[repeat(auto-fill");
  });
});
