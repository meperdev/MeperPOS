import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";
import { Select } from "./Select";

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

it("keeps the modal open when Escape only closes a Select list inside it", () => {
  const onClose = vi.fn();
  render(
    <Modal isOpen onClose={onClose} title="Prueba">
      <Select
        value=""
        placeholder="Elige"
        options={[{ value: "a", label: "Opción A" }]}
        onChange={vi.fn()}
      />
    </Modal>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Elige" }));
  fireEvent.keyDown(screen.getByRole("option", { name: "Opción A" }), { key: "Escape" });
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});
