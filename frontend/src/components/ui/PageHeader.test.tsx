import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageHeader } from "@/components/ui/PageHeader";

afterEach(cleanup);

/**
 * S1.2: below `lg` the section title lives in the fixed top bar, so the page
 * keeps its heading for assistive tech and heading order but stops painting a
 * second copy of it. jsdom resolves no media query here, so these are class
 * pins on the responsive contract, not visual proof.
 */
describe("PageHeader on mobile", () => {
  it("keeps the h1 in the document and paints it only from lg up", () => {
    render(<PageHeader title="Clientes" subtitle="Gestiona tu cartera" />);

    const heading = screen.getByRole("heading", { level: 1, name: "Clientes" });
    expect(heading).toHaveClass("sr-only");
    expect(heading).toHaveClass("lg:not-sr-only");
  });

  it("hides the description below lg", () => {
    render(<PageHeader title="Clientes" subtitle="Gestiona tu cartera" />);

    expect(screen.getByText("Gestiona tu cartera")).toHaveClass("hidden");
    expect(screen.getByText("Gestiona tu cartera")).toHaveClass("lg:block");
  });

  it("keeps the count with the heading instead of floating alone", () => {
    render(<PageHeader title="Clientes" count="12 registros" />);

    expect(screen.getByText("12 registros")).toHaveClass("hidden");
    expect(screen.getByText("12 registros")).toHaveClass("lg:inline-flex");
  });

  it("lays its actions out as one compact right-aligned row with intrinsic-width buttons", () => {
    render(
      <PageHeader
        title="Clientes"
        actions={
          <button type="button" className="w-full sm:w-auto">
            Nuevo cliente
          </button>
        }
      />,
    );

    const actions = screen.getByRole("button", { name: "Nuevo cliente" })
      .parentElement!;
    expect(actions.className).toContain("justify-end");
    // The page still asks for a full-width action; the header narrows it below lg.
    expect(actions.className).toContain("max-lg:[&>*]:w-auto");
  });
});

describe("PageHeader from lg up", () => {
  it("restores the visible title, description and count", () => {
    render(
      <PageHeader
        title="Clientes"
        subtitle="Gestiona tu cartera"
        count="12 registros"
        actions={<button type="button">Nuevo cliente</button>}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).not.toContain(" lg:hidden");
    expect(heading).toHaveClass("text-xl", "sm:text-2xl");
    expect(screen.getByText("Gestiona tu cartera")).toHaveClass("lg:block");
    expect(screen.getByText("12 registros")).toHaveClass("lg:inline-flex");
    expect(screen.getByRole("button", { name: "Nuevo cliente" })).toBeVisible();
  });

  it("renders nothing extra when the page has no subtitle, count or actions", () => {
    const { container } = render(<PageHeader title="Reportes" />);

    expect(screen.getByRole("heading", { level: 1, name: "Reportes" })).toBeInTheDocument();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
