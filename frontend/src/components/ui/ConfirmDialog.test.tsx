import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HAPTIC_PATTERNS } from "@/lib/haptics";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

/** Pretend the viewport is below (false) or at/above (true) Tailwind's `sm` breakpoint (640px). */
const stubSmBreakpoint = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
    configurable: true,
    writable: true,
  });
};

const restoreMatchMedia = () => Reflect.deleteProperty(window, "matchMedia");

const renderDialog = () =>
  render(
    <ConfirmDialog
      isOpen
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      title="Eliminar cliente"
      message="¿Estás seguro? Esta acción no se puede deshacer."
      confirmText="Eliminar"
      cancelText="Cancelar"
    />,
  );

describe("ConfirmDialog", () => {
  afterEach(restoreMatchMedia);

  it("stacks the actions as an action sheet below sm: confirm first, cancel last", () => {
    stubSmBreakpoint(false);
    renderDialog();

    const actions = screen.getAllByRole("button");
    expect(actions.map((action) => action.textContent)).toEqual(["Eliminar", "Cancelar"]);
    // 44px touch targets, full width, one per row.
    expect(actions[0].className).toContain("h-11");
    expect(actions[0].className).toContain("w-full");
    expect(actions[1].className).toContain("h-11");
    expect(actions[1].className).toContain("w-full");
    expect(actions[0].parentElement?.className).toContain("flex-col");
    // The confirm action keeps its destructive styling.
    expect(actions[0].className).toContain("bg-danger");
  });

  it("keeps the side-by-side layout from sm up", () => {
    stubSmBreakpoint(true);
    renderDialog();

    const actions = screen.getAllByRole("button");
    expect(actions.map((action) => action.textContent)).toEqual(["Cancelar", "Eliminar"]);
    expect(actions[0].className).toContain("flex-1");
    expect(actions[0].parentElement?.className).not.toContain("flex-col");
  });

  it("starts the action sheet on cancel instead of arming the destructive action", () => {
    stubSmBreakpoint(false);
    renderDialog();

    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Eliminar" })).not.toHaveFocus();
  });

  it("confirms from the sheet with the same handler", () => {
    stubSmBreakpoint(false);
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Eliminar cliente"
        message="¿Estás seguro?"
        confirmText="Eliminar"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmDialog haptics", () => {
  const vibrate = vi.fn(() => true);

  beforeEach(() => {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: vibrate,
    });
  });

  afterEach(() => {
    vibrate.mockClear();
    Reflect.deleteProperty(navigator, "vibrate");
  });

  it("buzzes the warning pattern when the action is confirmed", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.warning);
  });

  it("stays silent when the user backs out", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(vibrate).not.toHaveBeenCalled();
  });
});
