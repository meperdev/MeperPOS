import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/Button";

describe("Button label layout", () => {
  it("keeps the label on one line so a tight container never wraps it", () => {
    render(<Button>Nuevo proveedor</Button>);

    expect(screen.getByRole("button").className).toContain("whitespace-nowrap");
  });
});
