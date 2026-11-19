import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState, useRef } from "react";
import { BottomSheet } from "./BottomSheet";

const globalsCss = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
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

/** jsdom lays nothing out, so each drag test states the panel height it wants. */
function stubPanelHeight(height: number) {
  return vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      return {
        top: 0,
        bottom: height,
        left: 0,
        right: 390,
        width: 390,
        height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
}

function renderSheet(overrides: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(
    <BottomSheet isOpen onClose={onClose} title="Carrito de compras" {...overrides}>
      <button type="button">Primero</button>
      <button type="button">Último</button>
    </BottomSheet>,
  );
  return { ...view, onClose };
}

function panel() {
  return screen.getByRole("dialog");
}

describe("BottomSheet", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
    vi.restoreAllMocks();
  });

  it("renders nothing while it is closed", () => {
    const { container } = render(
      <BottomSheet isOpen={false} onClose={vi.fn()} title="Carrito de compras">
        <span>Contenido</span>
      </BottomSheet>,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("portals a bottom-anchored dialog named by its title, with a grab handle and a scrim", () => {
    renderSheet();

    const sheet = panel();
    // Out of the page tree: a sheet never inherits a parent's clipping or stacking context.
    expect(sheet.closest("body > div")).not.toBeNull();
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet.getAttribute("aria-labelledby")).toBe(
      screen.getByRole("heading", { name: "Carrito de compras" }).id,
    );
    expect(sheet.className).toContain("rounded-t-2xl");
    expect(sheet.className).toContain("pb-[var(--safe-bottom)]");
    expect(sheet.style.maxHeight).toBe("90dvh");
    expect(sheet.querySelector("[data-bottom-sheet-handle]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(document.querySelector("[data-bottom-sheet-scrim]")).not.toBeNull();
  });

  it("shows the quiet subtitle the drawer adds under the title", () => {
    renderSheet({ subtitle: "3 productos agregados" });

    expect(screen.getByRole("heading", { name: "Carrito de compras" })).toBeInTheDocument();
    expect(screen.getByText("3 productos agregados")).toBeInTheDocument();
  });

  it("closes when the scrim is tapped", () => {
    const { onClose } = renderSheet();

    fireEvent.click(document.querySelector("[data-bottom-sheet-scrim]")!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and marks the key handled so an outer dialog stays open", () => {
    const { onClose } = renderSheet();

    const notCancelled = fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(false);
  });

  it("leaves an Escape that a nested control already handled", () => {
    const { onClose } = renderSheet();
    // A Select inside the sheet closes its own list on Escape, from the document.
    const swallow = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    };
    document.addEventListener("keydown", swallow);

    fireEvent.keyDown(document.body, { key: "Escape" });

    document.removeEventListener("keydown", swallow);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("runs the close button from its label", () => {
    const { onClose } = renderSheet({ closeLabel: "Cerrar carrito" });

    fireEvent.click(screen.getByRole("button", { name: "Cerrar carrito" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the close button when the sheet is dismissed by gesture only", () => {
    renderSheet({ showCloseButton: false });

    expect(screen.queryByRole("button", { name: "Cerrar" })).toBeNull();
  });

  describe("focus", () => {
    function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
      const [open, setOpen] = useState(initiallyOpen);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir carrito
          </button>
          <BottomSheet
            isOpen={open}
            onClose={() => setOpen(false)}
            title="Carrito de compras"
          >
            <button type="button">Primero</button>
            <button type="button">Último</button>
          </BottomSheet>
        </>
      );
    }

    it("moves focus into the sheet and keeps Tab inside it", () => {
      render(<Harness />);

      expect(panel()).toHaveFocus();

      const close = screen.getByRole("button", { name: "Cerrar" });
      const last = screen.getByRole("button", { name: "Último" });

      last.focus();
      fireEvent.keyDown(last, { key: "Tab" });
      expect(close).toHaveFocus();

      close.focus();
      fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
      expect(last).toHaveFocus();
    });

    it("hands focus back to the control that opened it", () => {
      render(<Harness initiallyOpen={false} />);
      const opener = screen.getByRole("button", { name: "Abrir carrito" });

      // jsdom does not focus on click the way a browser does; the browser's
      // active element at open time is what the sheet has to restore.
      opener.focus();
      fireEvent.click(opener);
      fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

      expect(opener).toHaveFocus();
    });

    it("pulls focus back when something outside the sheet takes it", () => {
      render(<Harness />);
      const outside = document.createElement("input");
      document.body.appendChild(outside);

      outside.focus();
      fireEvent.focusIn(outside);

      expect(panel()).toHaveFocus();
      outside.remove();
    });

    it("gives focus back to the target the host names, over its own opener", () => {
      // The Select sheet hands focus back to its own trigger, which is not the
      // control that opened it: the sheet must not drag it back to the opener.
      function ClosingHarness() {
        const [open, setOpen] = useState(true);
        const targetRef = useRef<HTMLButtonElement>(null);
        return (
          <>
            <button type="button" ref={targetRef}>
              Disparador del select
            </button>
            <BottomSheet
              isOpen={open}
              onClose={() => setOpen(false)}
              title="Categoría"
              returnFocusTo={targetRef}
            >
              <button type="button">Opción A</button>
            </BottomSheet>
          </>
        );
      }

      render(<ClosingHarness />);
      fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

      expect(screen.getByRole("button", { name: "Disparador del select" })).toHaveFocus();
    });
  });

  it("locks the page behind it and gives the page back on close", () => {
    document.body.style.overflow = "";

    const { rerender } = render(
      <BottomSheet isOpen onClose={vi.fn()} title="Carrito de compras">
        <span>Contenido</span>
      </BottomSheet>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <BottomSheet isOpen={false} onClose={vi.fn()} title="Carrito de compras">
        <span>Contenido</span>
      </BottomSheet>,
    );
    expect(document.body.style.overflow).toBe("unset");
  });

  describe("drag to dismiss", () => {
    // The drag measures its own speed, so the clock has to be the test's.
    let clock = 0;
    const advance = (ms: number) => {
      clock += ms;
    };

    beforeEach(() => {
      clock = 0;
      vi.spyOn(performance, "now").mockImplementation(() => clock);
    });

    it("follows the finger on the handle and springs back inside the threshold", () => {
      stubPanelHeight(600);
      const { onClose } = renderSheet();
      const handle = document.querySelector<HTMLElement>("[data-bottom-sheet-handle]")!;

      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1, pointerType: "touch" });
      fireEvent.pointerMove(handle, { clientY: 180, pointerId: 1, pointerType: "touch" });

      // No transition while the finger owns the position, or the sheet lags behind it.
      expect(panel().style.transform).toBe("translateY(80px)");
      expect(panel().style.transition).toBe("none");

      advance(400);
      fireEvent.pointerUp(handle, { clientY: 180, pointerId: 1, pointerType: "touch" });

      expect(onClose).not.toHaveBeenCalled();
      expect(panel().style.transform).toBe("");
      expect(panel().style.transition).toBe("");
    });

    it("closes past 30% of its height", () => {
      stubPanelHeight(600);
      const { onClose } = renderSheet();
      const handle = document.querySelector<HTMLElement>("[data-bottom-sheet-handle]")!;

      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1, pointerType: "touch" });
      fireEvent.pointerMove(handle, { clientY: 300, pointerId: 1, pointerType: "touch" });
      advance(800);
      fireEvent.pointerUp(handle, { clientY: 300, pointerId: 1, pointerType: "touch" });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes on a fast flick even under the distance threshold", () => {
      stubPanelHeight(600);
      const { onClose } = renderSheet();
      const handle = document.querySelector<HTMLElement>("[data-bottom-sheet-handle]")!;

      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1, pointerType: "touch" });
      advance(40);
      fireEvent.pointerMove(handle, { clientY: 160, pointerId: 1, pointerType: "touch" });
      advance(40);
      fireEvent.pointerUp(handle, { clientY: 160, pointerId: 1, pointerType: "touch" });

      // 60px in 80ms: 0.75 px/ms, past the 0.5 px/ms flick speed.
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps a slow short drag below the threshold", () => {
      stubPanelHeight(600);
      const { onClose } = renderSheet();
      const handle = document.querySelector<HTMLElement>("[data-bottom-sheet-handle]")!;

      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1, pointerType: "touch" });
      advance(600);
      fireEvent.pointerMove(handle, { clientY: 160, pointerId: 1, pointerType: "touch" });
      advance(600);
      fireEvent.pointerUp(handle, { clientY: 160, pointerId: 1, pointerType: "touch" });

      expect(onClose).not.toHaveBeenCalled();
      expect(panel().style.transform).toBe("");
    });

    it("ignores a drag that starts on a control in the header", () => {
      stubPanelHeight(600);
      const { onClose } = renderSheet();
      const close = screen.getByRole("button", { name: "Cerrar" });

      fireEvent.pointerDown(close, { clientY: 100, pointerId: 1, pointerType: "touch" });
      fireEvent.pointerMove(close, { clientY: 400, pointerId: 1, pointerType: "touch" });
      fireEvent.pointerUp(close, { clientY: 400, pointerId: 1, pointerType: "touch" });

      expect(onClose).not.toHaveBeenCalled();
      expect(panel().style.transform).toBe("");
    });

    it("drags the sheet from the body only while the body is scrolled to the top", () => {
      stubPanelHeight(600);
      const { onClose } = renderSheet();
      const body = panel().querySelector<HTMLElement>("[data-bottom-sheet-body]")!;

      body.scrollTop = 120;
      fireEvent.pointerDown(body, { clientY: 100, pointerId: 2, pointerType: "touch" });
      fireEvent.pointerMove(body, { clientY: 400, pointerId: 2, pointerType: "touch" });
      expect(panel().style.transform).toBe("");
      fireEvent.pointerUp(body, { clientY: 400, pointerId: 2, pointerType: "touch" });
      expect(onClose).not.toHaveBeenCalled();

      body.scrollTop = 0;
      fireEvent.pointerDown(body, { clientY: 100, pointerId: 3, pointerType: "touch" });
      fireEvent.pointerMove(body, { clientY: 160, pointerId: 3, pointerType: "touch" });
      expect(panel().style.transform).toBe("translateY(60px)");
      fireEvent.pointerCancel(body, { pointerId: 3, pointerType: "touch" });

      // A cancelled gesture is never a dismissal.
      expect(onClose).not.toHaveBeenCalled();
      expect(panel().style.transform).toBe("");
    });
  });

  describe("height between views", () => {
    let observerCallback: ResizeObserverCallback | null = null;

    beforeEach(() => {
      observerCallback = null;
      class TestResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          observerCallback = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: TestResizeObserver,
      });
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: TestResizeObserver,
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(window, "ResizeObserver");
      Reflect.deleteProperty(globalThis, "ResizeObserver");
    });

    function observe(height: number) {
      observerCallback?.(
        [{ contentRect: { height } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    }

    function stubAnimate() {
      const animate = vi.fn<
        (keyframes: Keyframe[], options?: KeyframeAnimationOptions) => {
          playState: AnimationPlayState;
          cancel: () => void;
          finish: () => void;
        }
      >(() => ({
        playState: "running",
        cancel: vi.fn(),
        finish: vi.fn(),
      }));
      Object.defineProperty(Element.prototype, "animate", {
        configurable: true,
        writable: true,
        value: animate,
      });
      return animate;
    }

    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, "animate");
    });

    it("animates the panel from its old height to the new one when the content switches", () => {
      const animate = stubAnimate();

      renderSheet();
      observe(320);
      expect(animate).not.toHaveBeenCalled();

      observe(420);

      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.calls[0][0]).toEqual([{ height: "320px" }, { height: "420px" }]);
      expect(animate.mock.calls[0][1]).toMatchObject({ duration: 220 });
      // The panel itself stays auto: the animation only borrows the height.
      expect(panel().style.height).toBe("");
    });

    it("leaves the height alone when nothing changed", () => {
      const animate = stubAnimate();

      renderSheet();
      observe(320);
      observe(320.4);

      expect(animate).not.toHaveBeenCalled();
    });

    it("changes the height without motion under prefers-reduced-motion", () => {
      const animate = stubAnimate();
      stubMediaQuery({ [REDUCED_MOTION]: true });

      renderSheet();
      observe(320);
      observe(420);

      expect(animate).not.toHaveBeenCalled();
    });
  });

  it("keeps the travel out of reduced motion and leaves only the fade", () => {
    expect(globalsCss).toContain("animation: sheet-up");

    const reduced = globalsCss.slice(
      globalsCss.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    const start = reduced.lastIndexOf(".bottom-sheet-panel");
    expect(start).toBeGreaterThanOrEqual(0);

    const sheetRules = reduced.slice(start, start + 160);
    expect(sheetRules).toContain("fade-in");
    expect(sheetRules).not.toContain("translateY");
  });
});
