import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { InlineConfirmButton } from "./InlineConfirmButton";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function stubMediaQuery(answers: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: answers[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** A clickable row around the control, the way a list row or card wraps it. */
function renderControl(
  props: Partial<ComponentProps<typeof InlineConfirmButton>> = {},
) {
  const onConfirm = vi.fn();
  const rowClick = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <div onClick={rowClick}>
      <InlineConfirmButton
        ariaLabel="Eliminar pago"
        onConfirm={onConfirm}
        {...props}
      >
        <span aria-hidden="true">icono</span>
      </InlineConfirmButton>
      <button type="button">Fuera</button>
    </div>,
  );
  return { onConfirm, rowClick, user, view };
}

const trigger = () => screen.queryByRole("button", { name: "Eliminar pago" });
const confirmButton = (name = "¿Eliminar?") =>
  screen.queryByRole("button", { name });

describe("InlineConfirmButton", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("arms in place: the idle control gives way to a labelled confirm and a cancel", async () => {
    const { user } = renderControl();

    expect(trigger()).toBeInTheDocument();
    expect(confirmButton()).not.toBeInTheDocument();

    await user.click(trigger()!);

    expect(confirmButton()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    // The idle control is out of reach while the decision is on screen.
    expect(trigger()).not.toBeInTheDocument();
  });

  it("takes the confirm wording from the caller", async () => {
    const { user } = renderControl({ confirmLabel: "¿Desactivar?" });

    await user.click(trigger()!);

    expect(confirmButton("¿Desactivar?")).toBeInTheDocument();
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it("moves the focus to the confirm when it appears", async () => {
    const { user } = renderControl();

    await user.click(trigger()!);

    expect(confirmButton()).toHaveFocus();
  });

  it("runs the action once and never again while it is pending", async () => {
    let resolve!: () => void;
    const pendingAction = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const { onConfirm, user } = renderControl({ onConfirm: pendingAction });
    expect(onConfirm).not.toBe(pendingAction);

    await user.click(trigger()!);
    await user.click(confirmButton()!);

    expect(pendingAction).toHaveBeenCalledTimes(1);
    const pending = confirmButton();
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    // A second press lands on a disabled control, so the action cannot double-fire.
    await user.click(pending!);
    expect(pendingAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve();
    });

    expect(trigger()).toBeInTheDocument();
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it("cancels without running the action and hands the focus back", async () => {
    const { onConfirm, user } = renderControl();

    await user.click(trigger()!);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(confirmButton()).not.toBeInTheDocument();
    expect(trigger()).toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("gives up on Escape and hands the focus back", async () => {
    const { onConfirm, user } = renderControl();

    await user.click(trigger()!);
    await user.keyboard("{Escape}");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(confirmButton()).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("gives up when the focus leaves the control, without dragging it back", async () => {
    const { user } = renderControl();

    await user.click(trigger()!);
    await user.click(screen.getByRole("button", { name: "Fuera" }));

    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fuera" })).toHaveFocus();
  });

  it("reverts on its own after four seconds without an answer", async () => {
    vi.useFakeTimers();
    try {
      const onConfirm = vi.fn();
      render(
        <InlineConfirmButton ariaLabel="Eliminar pago" onConfirm={onConfirm}>
          <span aria-hidden="true">icono</span>
        </InlineConfirmButton>,
      );

      fireEvent.click(trigger()!);
      expect(confirmButton()).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3999);
      });
      expect(confirmButton()).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(confirmButton()).not.toBeInTheDocument();
      expect(trigger()).toBeInTheDocument();
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers the caller's own revert window", async () => {
    vi.useFakeTimers();
    try {
      render(
        <InlineConfirmButton
          ariaLabel="Eliminar pago"
          onConfirm={vi.fn()}
          autoRevertMs={1000}
        >
          <span aria-hidden="true">icono</span>
        </InlineConfirmButton>,
      );

      fireEvent.click(trigger()!);
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(confirmButton()).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops every click from reaching a clickable row around it", async () => {
    const { user, rowClick, onConfirm } = renderControl();

    await user.click(trigger()!);
    await user.click(confirmButton()!);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("keeps the cancel click out of the row as well", async () => {
    const { user, rowClick } = renderControl();

    await user.click(trigger()!);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(rowClick).not.toHaveBeenCalled();
  });

  it("announces what the armed control is asking for", async () => {
    const { user, view } = renderControl();
    const status = () => view.container.querySelector('[role="status"]');

    expect(status()).toBeEmptyDOMElement();

    await user.click(trigger()!);

    expect(status()).toHaveTextContent("Confirma para eliminar");
  });

  it("announces a caller's own sentence instead of the default one", async () => {
    const { user, view } = renderControl({ announce: "Confirma para desactivar" });

    await user.click(trigger()!);

    expect(view.container.querySelector('[role="status"]')).toHaveTextContent(
      "Confirma para desactivar",
    );
  });

  it("drops the width morph under prefers-reduced-motion", async () => {
    stubMediaQuery({ [REDUCED_MOTION]: true });
    const { user, view } = renderControl();

    const root = view.container.querySelector("[data-inline-confirm]");
    expect(root).toHaveAttribute("data-motion", "reduced");
    expect(
      view.container.querySelector("[data-inline-confirm-armed]"),
    ).not.toHaveClass("transition-[max-width,opacity]");

    // The state change still happens; only the travel is gone.
    await user.click(trigger()!);
    expect(confirmButton()).toBeInTheDocument();
  });

  it("keeps the morph when motion is welcome", async () => {
    stubMediaQuery({ [REDUCED_MOTION]: false });
    const { view } = renderControl();

    const root = view.container.querySelector("[data-inline-confirm]");
    expect(root).toHaveAttribute("data-motion", "full");
    expect(
      view.container.querySelector("[data-inline-confirm-armed]"),
    ).toHaveClass("transition-[max-width,opacity]");
  });

  it("does not arm a disabled control", async () => {
    const { user } = renderControl({ disabled: true });

    await user.click(trigger()!);

    expect(confirmButton()).not.toBeInTheDocument();
    expect(trigger()).toBeDisabled();
  });

  it("renders a labelled action when the caller asks for text", async () => {
    const { user } = renderControl({
      variant: "text",
      ariaLabel: "Eliminar",
      children: "Eliminar",
    });

    expect(screen.getByRole("button", { name: "Eliminar" })).toHaveClass("px-3");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(confirmButton()).toBeInTheDocument();
  });
});
