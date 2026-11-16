import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { HAPTIC_PATTERNS } from "@/lib/haptics";
import { ConfirmDialog } from "./ConfirmDialog";

vi.mock("./Modal", () => ({
  Modal: ({
    isOpen,
    ariaLabel,
    children,
  }: {
    isOpen: boolean;
    ariaLabel?: string;
    children: ReactNode;
  }) => (isOpen ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null),
}));

const vibrate = vi.fn(() => true);

beforeEach(() => {
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    writable: true,
    value: vibrate,
  });
});

afterEach(() => {
  cleanup();
  vibrate.mockClear();
  delete (navigator as unknown as Record<string, unknown>).vibrate;
});

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      title="Eliminar producto"
      message="Esta acción no se puede deshacer."
      {...overrides}
    />,
  );
  return { onClose, onConfirm };
}

describe("ConfirmDialog", () => {
  it("confirms the destructive action and closes", async () => {
    const { onClose, onConfirm } = renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes without acting when the user backs out", async () => {
    const { onClose, onConfirm } = renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("buzzes the warning pattern when the deletion is confirmed", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.warning);
  });
});
