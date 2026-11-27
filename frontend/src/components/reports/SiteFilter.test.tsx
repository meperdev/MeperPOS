import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { LocationSite } from "@/types";
import { SiteFilter } from "./SiteFilter";

const site = (id: string, name: string): LocationSite => ({
  id,
  name,
  type: "STORE",
  isDefault: false,
});

describe("SiteFilter", () => {
  it('shows "Todas las sedes" plus every readable site', () => {
    render(
      <SiteFilter
        sites={[site("site-a", "Chapinero"), site("site-b", "Usaquén")]}
        value=""
        onChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Todas las sedes" }));

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Todas las sedes", "Chapinero", "Usaquén"]);
  });

  it("reports the chosen site to the page", () => {
    const onChange = vi.fn();
    render(
      <SiteFilter
        sites={[site("site-a", "Chapinero"), site("site-b", "Usaquén")]}
        value=""
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Todas las sedes" }));
    fireEvent.click(screen.getByRole("option", { name: "Usaquén" }));

    expect(onChange).toHaveBeenCalledWith("site-b");
  });

  it("is not rendered for a single-site organization", () => {
    const { container } = render(
      <SiteFilter sites={[site("site-a", "Chapinero")]} value="" onChange={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("names the selected site on its trigger", () => {
    render(
      <SiteFilter
        sites={[site("site-a", "Chapinero"), site("site-b", "Usaquén")]}
        value="site-b"
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Usaquén" })).toBeInTheDocument();
  });
});
