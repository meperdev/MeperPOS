import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

afterEach(cleanup);
it("keeps scrolling enabled by default", () => {
  render(<Modal isOpen onClose={vi.fn()} title="Prueba"><span>Contenido</span></Modal>);
  expect(screen.getByText("Contenido").parentElement?.className).toContain("overflow-y-auto");
});
it("allows a fitted consumer to opt out without clipping content", () => {
  render(<Modal isOpen onClose={vi.fn()} title="Prueba" scrollContent={false}><span>Contenido</span></Modal>);
  expect(screen.getByText("Contenido").parentElement?.className).not.toMatch(/overflow-y-auto|overflow-hidden/);
  expect(screen.getByRole("heading").className).not.toContain("truncate");
});

it("renders footer outside the scrolling content area when provided", () => {
  render(
    <Modal isOpen onClose={vi.fn()} title="Prueba" footer={<button>Guardar</button>}>
      <span>Contenido</span>
    </Modal>,
  );
  expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  expect(screen.getByText("Contenido").parentElement?.className).toContain("overflow-y-auto");
  expect(screen.getByRole("button", { name: "Guardar" }).parentElement?.className).toContain("border-t");
});
