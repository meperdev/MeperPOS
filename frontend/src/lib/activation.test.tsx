import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activationProps } from "./activation";

function Row({ onOpen, onNested }: { onOpen: () => void; onNested?: () => void }) {
  return (
    <div {...activationProps(onOpen, "Ver detalle de venta 7")}>
      Venta 7
      <button type="button" onClick={(event) => { event.stopPropagation(); onNested?.(); }}>
        Descargar
      </button>
    </div>
  );
}

describe("activationProps", () => {
  it("makes a clickable container a named, focusable button", () => {
    render(<Row onOpen={() => {}} />);
    const row = screen.getByRole("button", { name: "Ver detalle de venta 7" });
    expect(row).toHaveAttribute("tabindex", "0");
  });

  it("opens on click, Enter and Space", async () => {
    const onOpen = vi.fn();
    render(<Row onOpen={onOpen} />);
    const row = screen.getByRole("button", { name: "Ver detalle de venta 7" });
    await userEvent.click(row);
    row.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("ignores keys pressed on a nested control", async () => {
    const onOpen = vi.fn();
    const onNested = vi.fn();
    render(<Row onOpen={onOpen} onNested={onNested} />);
    screen.getByRole("button", { name: "Descargar" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onNested).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
