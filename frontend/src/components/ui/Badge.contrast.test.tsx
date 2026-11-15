import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/Badge";

describe("Badge variant contrast mapping", () => {
  it("uses neutral token classes for default variant", () => {
    render(<Badge variant="default">Rol</Badge>);

    const badge = screen.getByText("Rol");
    expect(badge.className).toContain("bg-muted");
    expect(badge.className).toContain("text-foreground");
    expect(badge.className).toContain("border-border");
  });

  it("uses shared chipStyles source for secondary variant", () => {
    render(<Badge variant="secondary">Sin pago</Badge>);

    const badge = screen.getByText("Sin pago");
    expect(badge.className).toContain("bg-muted");
    expect(badge.className).toContain("text-foreground");
    expect(badge.className).toContain("border-border");
  });

  it("maps tinted tones to status tokens with the -text variant for labels", () => {
    render(<Badge variant="danger">Cancelada</Badge>);

    const badge = screen.getByText("Cancelada");
    expect(badge.className).toContain("border-danger/30");
    expect(badge.className).toContain("bg-danger/10");
    expect(badge.className).toContain("text-danger-text");
  });

  it("never paints a Tailwind palette hue", () => {
    const { container } = render(
      <>
        <Badge variant="default" dot>a</Badge>
        <Badge variant="success" dot>b</Badge>
        <Badge variant="warning" dot>c</Badge>
        <Badge variant="danger" dot>d</Badge>
        <Badge variant="primary" dot>e</Badge>
        <Badge variant="secondary" dot>f</Badge>
      </>,
    );

    const palette = /\b(emerald|rose|red|amber|slate|stone|green|orange|yellow)-\d/;
    expect(container.innerHTML).not.toMatch(palette);
  });

  it("keeps the chip and its dot on one line inside flex rows", () => {
    render(
      <Badge variant="info" dot>
        Ahorros: 12345678901234567890
      </Badge>,
    );

    const badge = screen.getByText(/Ahorros/);
    expect(badge.className).toContain("whitespace-nowrap");
    expect(badge.className).toContain("shrink-0");
    expect(badge.querySelector("span")!.className).toContain("shrink-0");
  });
});
