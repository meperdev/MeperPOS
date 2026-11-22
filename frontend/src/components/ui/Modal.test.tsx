import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";
import { Select } from "./Select";

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

it("keeps focus inside a portaled desktop Select popover without closing the modal on Escape", () => {
  stubSmBreakpoint(true);
  const onClose = vi.fn();
  try {
    render(
      <Modal isOpen onClose={onClose} title="Nuevo gasto">
        <Select
          value="CASH"
          label="Método"
          options={[
            { value: "CASH", label: "Efectivo" },
            { value: "CARD", label: "Tarjeta" },
          ]}
          onChange={vi.fn()}
        />
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Nuevo gasto" });
    const trigger = screen.getByRole("button", { name: "Método" });
    fireEvent.click(trigger);

    const option = screen.getByRole("option", { name: "Efectivo" });
    expect(dialog.contains(option)).toBe(false);
    expect(option.closest("[data-select-popover]")).not.toBeNull();
    expect(option).toHaveFocus();

    fireEvent.keyDown(option, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  } finally {
    restoreMatchMedia();
  }
});

describe("bottom sheet below sm", () => {
  afterEach(restoreMatchMedia);

  it("anchors the panel to the bottom as a sheet with a drag handle", () => {
    stubSmBreakpoint(false);

    render(
      <Modal isOpen onClose={vi.fn()} title="Nuevo cliente">
        <span>Contenido</span>
      </Modal>,
    );

    const panel = screen.getByRole("dialog", { name: "Nuevo cliente" });
    expect(panel).toHaveAttribute("data-presentation", "sheet");
    // Rounded top corners only: the sheet is welded to the bottom edge.
    expect(panel.className).toContain("rounded-t-2xl");
    expect(panel.className).not.toContain("rounded-xl");
    // Bottom padding pays the home indicator, and the height leaves the status bar alone.
    expect(panel.className).toContain("pb-[var(--safe-bottom)]");
    expect(panel.style.maxHeight).toContain("100dvh");
    expect(panel.style.maxHeight).toContain("var(--safe-top)");
    expect(panel.querySelector("[data-sheet-handle]")).not.toBeNull();
    expect(panel.querySelector("[data-sheet-handle]")).toHaveAttribute("aria-hidden", "true");
    // The panel is anchored by its container, not centred by it.
    expect(panel.parentElement?.className).toContain("justify-end");
  });

  it("keeps today's centred dialog from sm up", () => {
    stubSmBreakpoint(true);

    render(
      <Modal isOpen onClose={vi.fn()} title="Nuevo cliente">
        <span>Contenido</span>
      </Modal>,
    );

    const panel = screen.getByRole("dialog", { name: "Nuevo cliente" });
    expect(panel).toHaveAttribute("data-presentation", "dialog");
    expect(panel.className).toContain("max-w-2xl");
    expect(panel.querySelector("[data-sheet-handle]")).toBeNull();
    expect(panel.parentElement?.className).toContain("items-center");
  });

  it("closes when the handle is dragged down past the threshold", () => {
    stubSmBreakpoint(false);
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Nuevo cliente">
        <span>Contenido</span>
      </Modal>,
    );

    const handle = screen.getByRole("dialog").querySelector("[data-sheet-handle]")!;
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 220, pointerId: 1 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("snaps back when the drag is short", () => {
    stubSmBreakpoint(false);
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Nuevo cliente">
        <span>Contenido</span>
      </Modal>,
    );

    const panel = screen.getByRole("dialog");
    const handle = panel.querySelector("[data-sheet-handle]")!;
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 130, pointerId: 1 });

    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  it("ignores the drag when the modal is not dismissible", () => {
    stubSmBreakpoint(false);
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Nuevo cliente" dismissible={false}>
        <span>Contenido</span>
      </Modal>,
    );

    const panel = screen.getByRole("dialog");
    const handle = panel.querySelector("[data-sheet-handle]")!;
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 300, pointerId: 1 });

    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  it("sits above the on-screen keyboard while it is open", () => {
    stubSmBreakpoint(false);
    Object.defineProperty(window, "innerHeight", {
      value: 844,
      configurable: true,
      writable: true,
    });
    const listeners = new Set<() => void>();
    const viewport = {
      width: 390,
      height: 844,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => true,
    };
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
      writable: true,
    });

    try {
      render(
        <Modal isOpen onClose={vi.fn()} title="Nuevo cliente">
          <input aria-label="Nombre" />
        </Modal>,
      );

      const container = screen.getByRole("dialog").parentElement!;
      expect(container.style.bottom).toBe("");

      viewport.height = 544;
      act(() => {
        for (const listener of listeners) listener();
      });

      expect(container.style.bottom).toBe("300px");
    } finally {
      Reflect.deleteProperty(window, "visualViewport");
    }
  });

  it("closes only the select sheet on Escape when the select lives inside the modal", () => {
    stubSmBreakpoint(false);
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose} title="Nuevo cliente">
        <Select
          value=""
          label="Tipo de documento"
          options={[{ value: "CC", label: "Cédula de ciudadanía" }]}
          onChange={vi.fn()}
        />
      </Modal>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tipo de documento" }));
    const option = screen.getByRole("option", { name: "Cédula de ciudadanía" });
    // The modal's focus trap guards the page behind it, not a sheet it opened.
    expect(option).toHaveFocus();

    fireEvent.keyDown(option, { key: "Escape" });

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Nuevo cliente" })).toBeInTheDocument();
  });
});

/**
 * Counts the visual-viewport subscriptions a component holds: a closed modal
 * should hold none.
 */
const stubCountedVisualViewport = () => {
  let listeners = 0;
  Object.defineProperty(window, "visualViewport", {
    value: {
      width: 390,
      height: 844,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
      addEventListener: () => {
        listeners += 1;
      },
      removeEventListener: () => {
        listeners -= 1;
      },
      dispatchEvent: () => true,
    },
    configurable: true,
    writable: true,
  });
  return { listenerCount: () => listeners };
};

describe("keyboard listeners follow the open state", () => {
  afterEach(() => Reflect.deleteProperty(window, "visualViewport"));

  it("subscribes to the visual viewport only while the modal is open", () => {
    stubSmBreakpoint(false);
    const { listenerCount } = stubCountedVisualViewport();

    const { rerender } = render(
      <Modal isOpen={false} onClose={vi.fn()} title="Nuevo cliente">
        <span>Contenido</span>
      </Modal>,
    );
    expect(listenerCount()).toBe(0);

    rerender(
      <Modal isOpen onClose={vi.fn()} title="Nuevo cliente">
        <span>Contenido</span>
      </Modal>,
    );
    expect(listenerCount()).toBeGreaterThan(0);

    rerender(
      <Modal isOpen={false} onClose={vi.fn()} title="Nuevo cliente">
        <span>Contenido</span>
      </Modal>,
    );
    expect(listenerCount()).toBe(0);
  });
});

// A modal that lands on a text field raises the phone keyboard the moment it
// opens, over content the reader has not seen yet. The dialog (or its close
// control) takes the focus instead; desktop keeps landing on the first field.
describe("initial focus follows the pointer", () => {
  afterEach(restoreMatchMedia);

  function stubPointer(answers: Record<string, boolean>) {
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

  function renderForm() {
    render(
      <Modal isOpen onClose={() => {}} title="Nuevo cliente">
        <input aria-label="Nombre" />
        <button type="button">Guardar</button>
      </Modal>,
    );
    return screen.getByRole("textbox", { name: "Nombre" });
  }

  it("lands on the first text field for a mouse", () => {
    stubPointer({});

    expect(renderForm()).toHaveFocus();
  });

  it("lands on the close control on a touch device instead of a text field", () => {
    stubPointer({ "(pointer: coarse)": true });

    const field = renderForm();

    expect(field).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
  });

  it("does not honour a text field marked as the autofocus target on a touch device", () => {
    stubPointer({ "(pointer: coarse)": true });

    render(
      <Modal isOpen onClose={() => {}} title="Notas">
        <button type="button">Atrás</button>
        <textarea aria-label="Detalle" data-modal-autofocus />
      </Modal>,
    );

    expect(screen.getByRole("textbox", { name: "Detalle" })).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Atrás" })).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
  });

  it("falls back to the dialog itself when it has no close control", () => {
    stubPointer({ "(pointer: coarse)": true });

    render(
      <Modal isOpen onClose={() => {}} ariaLabel="Notas">
        <input aria-label="Detalle" />
      </Modal>,
    );

    expect(screen.getByRole("textbox", { name: "Detalle" })).not.toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Notas" })).toHaveFocus();
  });
});
