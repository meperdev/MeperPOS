import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/Input";

describe("Input number stepper", () => {
  it("names each stepper after its field so identical fields stay distinguishable", () => {
    render(
      <>
        <Input label="Cantidad" type="number" defaultValue="1" />
        <Input label="Precio" type="number" defaultValue="1" />
      </>,
    );

    expect(screen.getByRole("button", { name: "Aumentar Cantidad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disminuir Cantidad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aumentar Precio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disminuir Precio" })).toBeInTheDocument();
  });

  it("falls back to generic stepper names when the field has no text label", () => {
    render(<Input type="number" defaultValue="1" />);

    expect(screen.getByRole("button", { name: "Aumentar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disminuir" })).toBeInTheDocument();
  });
});
