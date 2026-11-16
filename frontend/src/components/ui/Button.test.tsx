import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/Button";

describe("Button label layout", () => {
  it("keeps the label on one line so a tight container never wraps it", () => {
    render(<Button>Nuevo proveedor</Button>);

    expect(screen.getByRole("button").className).toContain("whitespace-nowrap");
  });
});

describe("Button touch targets (S3.2)", () => {
  it("raises small buttons to 44px on phones without touching the desktop size", () => {
    render(<Button size="sm">Detalle</Button>);

    const button = screen.getByRole("button", { name: "Detalle" });
    // Phones only: a row action under a thumb, still h-8 on a pointer device.
    expect(button.className).toContain("max-sm:min-h-11");
    expect(button.className).toContain("max-sm:min-w-11");
    expect(button.className).toContain("h-8");
    expect(button.className).not.toMatch(/(^|\s)sm:min-h-11/);
  });

  it("leaves the default size alone, so no page grows a second touch floor", () => {
    render(<Button>Guardar</Button>);

    expect(screen.getByRole("button", { name: "Guardar" }).className).not.toContain(
      "max-sm:min-h-11",
    );
  });
});
