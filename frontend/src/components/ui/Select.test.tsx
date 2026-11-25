import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Select } from "@/components/ui/Select";

const baseOptions = [
  { value: "a", label: "Opción A" },
  { value: "b", label: "Opción B" },
];

const fourOptions = [
  { value: "a", label: "Opción A" },
  { value: "b", label: "Opción B" },
  { value: "c", label: "Opción C" },
  { value: "d", label: "Opción D" },
];

/** Pretend the viewport is below (false) or at/above (true) Tailwind's `sm` breakpoint (640px). */
const stubSmBreakpoint = (matches: boolean) => {
  const matchMedia = vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, "matchMedia", {
    value: matchMedia,
    configurable: true,
    writable: true,
  });
  return matchMedia;
};

const restoreMatchMedia = () => {
  Reflect.deleteProperty(window, "matchMedia");
};

describe("Select", () => {
  it("shows the placeholder when no option is selected", () => {
    const onChange = vi.fn();
    render(
      <Select
        value="x"
        placeholder="Elige algo"
        options={baseOptions}
        onChange={onChange}
      />
    );

    expect(screen.getByText("Elige algo")).toBeInTheDocument();
  });

  it("renders the label prop above the trigger", () => {
    const onChange = vi.fn();
    render(
      <Select
        value=""
        label="Categoría"
        options={baseOptions}
        onChange={onChange}
      />
    );

    expect(screen.getByText("Categoría")).toBeInTheDocument();
  });

  it("moves focus to the trigger when Tab leaves an open list, without cancelling Tab", () => {
    render(<Select value="" options={baseOptions} onChange={vi.fn()} />);

    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    const option = screen.getByRole("option", { name: "Opción A" });
    option.focus();

    const notCancelled = fireEvent.keyDown(option, { key: "Tab" });

    expect(notCancelled).toBe(true);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens the popover and lists the options when the trigger is clicked", () => {
    const onChange = vi.fn();
    render(<Select value="" options={baseOptions} onChange={onChange} />);

    expect(screen.queryByText("Opción A")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Opción A")).toBeInTheDocument();
    expect(screen.getByText("Opción B")).toBeInTheDocument();
  });

  it("calls onChange with the selected value and closes the popover", () => {
    const onChange = vi.fn();
    render(<Select value="" options={baseOptions} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Opción A"));

    expect(onChange).toHaveBeenCalledWith("a");
    expect(screen.queryByText("Opción B")).not.toBeInTheDocument();
  });

  it("highlights the selected option with a check icon and selected classes", () => {
    const onChange = vi.fn();
    render(<Select value="b" options={baseOptions} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button"));

    // The trigger first renders the selected label, then the option list echo.
    const selectedOptionLabel = screen.getAllByText("Opción B")[1];
    const selectedRow = selectedOptionLabel.closest("div")!.parentElement!;
    expect(selectedRow.className).toContain("bg-primary-light");
    expect(selectedRow.className).toContain("text-primary-text");
    expect(selectedRow.className).toContain("font-bold");
    expect(selectedRow.querySelector("svg")).toBeInTheDocument();

    const unselectedRow = screen
      .getByText("Opción A")
      .closest("div")!.parentElement!;
    expect(unselectedRow.querySelector("svg")).toBeNull();
  });

  it("renders an option badge when one is provided", () => {
    const onChange = vi.fn();
    render(
      <Select
        value=""
        options={[{ value: "a", label: "Opción A", badge: "NUEVO" }]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("NUEVO")).toBeInTheDocument();
  });

  it("sizes option rows for touch: 44px min height, compact again from sm up", () => {
    render(<Select value="" options={baseOptions} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));

    const row = screen.getByRole("option", { name: "Opción A" });
    expect(row.className).toContain("min-h-11");
    expect(row.className).toContain("sm:min-h-9");
  });

  describe("desktop popover portal and placement", () => {
    const rects = new Map<string, Partial<DOMRect>>();
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;

    afterEach(() => {
      rects.clear();
      restoreMatchMedia();
      Object.defineProperty(window, "innerHeight", {
        value: originalInnerHeight,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(window, "innerWidth", {
        value: originalInnerWidth,
        configurable: true,
        writable: true,
      });
    });

    const mockRects = () =>
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const key = this.hasAttribute("data-select-trigger") ? "trigger" : "";
        const rect = rects.get(key) ?? {};
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
          ...rect,
        } as DOMRect;
      });

    it("portals the listbox to document.body so overflow-hidden or scroll containers never clip it", () => {
      stubSmBreakpoint(true);
      rects.set("trigger", { top: 200, bottom: 236, left: 40, right: 240, width: 200, height: 36 });
      const spy = mockRects();
      const { container } = render(
        <div data-clip-box style={{ overflow: "hidden" }}>
          <div data-scroller style={{ overflowY: "auto" }}>
            <Select value="" label="Método" options={baseOptions} onChange={vi.fn()} />
          </div>
        </div>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Método" }));

      const popover = document.body.querySelector<HTMLElement>("[data-select-popover]");
      expect(popover).not.toBeNull();
      expect(container.contains(popover)).toBe(false);
      expect(popover?.style.position).toBe("fixed");
      expect(popover?.style.left).toBe("40px");
      expect(popover?.style.width).toBe("200px");
      spy.mockRestore();
    });

    it("opens upwards when the viewport lacks room below and has more room above", () => {
      stubSmBreakpoint(true);
      Object.defineProperty(window, "innerHeight", { value: 420, configurable: true, writable: true });
      rects.set("trigger", { top: 340, bottom: 376, left: 24, right: 224, width: 200, height: 36 });
      const spy = mockRects();
      render(<Select value="" options={fourOptions} onChange={vi.fn()} />);

      fireEvent.click(screen.getByRole("button"));

      const popover = document.body.querySelector<HTMLElement>("[data-select-popover]")!;
      expect(popover).toHaveAttribute("data-placement", "top");
      expect(popover.style.bottom).toBe(`${420 - 340 + 6}px`);
      spy.mockRestore();
    });

    it("opens downwards when the viewport has room below even inside a compact scroll box", () => {
      stubSmBreakpoint(true);
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true, writable: true });
      rects.set("trigger", { top: 190, bottom: 226, left: 24, right: 224, width: 200, height: 36 });
      const spy = mockRects();
      render(
        <div data-scroller style={{ overflowY: "auto", maxHeight: "150px" }}>
          <Select value="" options={fourOptions} onChange={vi.fn()} />
        </div>,
      );

      fireEvent.click(screen.getByRole("button"));

      const popover = document.body.querySelector<HTMLElement>("[data-select-popover]")!;
      expect(popover).toHaveAttribute("data-placement", "bottom");
      expect(popover.style.top).toBe(`${226 + 6}px`);
      spy.mockRestore();
    });

    it("opens the list as a sheet below sm instead of a desktop popover", () => {
      const spy = mockRects();
      const matchMedia = stubSmBreakpoint(false);
      render(
        <div data-scroller style={{ overflowY: "auto" }}>
          <Select value="" options={fourOptions} onChange={vi.fn()} />
        </div>,
      );

      fireEvent.click(screen.getByRole("button"));

      expect(document.body.querySelector("[data-select-popover]")).toBeNull();
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      expect(matchMedia).toHaveBeenCalledWith("(min-width: 640px)");
      spy.mockRestore();
    });

    it("closes the popover when an outer scroll ancestor scrolls the trigger out of view", () => {
      stubSmBreakpoint(true);
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true, writable: true });
      let triggerRect: Partial<DOMRect> = {
        top: 200,
        bottom: 236,
        left: 24,
        right: 224,
        width: 200,
        height: 36,
      };
      const spy = vi
        .spyOn(Element.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: Element) {
          const base = this.hasAttribute("data-select-trigger")
            ? triggerRect
            : this.hasAttribute("data-outer-scroller")
              ? { top: 100, bottom: 500, height: 400 }
              : this.hasAttribute("data-inner-scroller")
                ? { top: 180, bottom: 320, height: 140 }
                : {};
          return {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            width: 0,
            height: 0,
            x: 0,
            y: 0,
            toJSON: () => ({}),
            ...base,
          } as DOMRect;
        });

      render(
        <div data-outer-scroller style={{ overflowY: "auto" }}>
          <div data-inner-scroller style={{ overflowY: "auto" }}>
            <Select value="" label="Método" options={baseOptions} onChange={vi.fn()} />
          </div>
        </div>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Método" }));
      expect(document.body.querySelector("[data-select-popover]")).not.toBeNull();

      triggerRect = { top: 20, bottom: 56, left: 24, right: 224, width: 200, height: 36 };
      fireEvent.scroll(window);

      expect(document.body.querySelector("[data-select-popover]")).toBeNull();
      spy.mockRestore();
    });
  });

  it("closes the popover when a mousedown happens outside the container", () => {
    const onChange = vi.fn();
    render(<Select value="" options={baseOptions} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Opción A")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText("Opción A")).not.toBeInTheDocument();
  });

  describe("native select behind the trigger", () => {
    it("names the trigger by its label and keeps a hidden native select beside it", () => {
      render(<Select value="a" label="Método" name="method" options={baseOptions} onChange={vi.fn()} />);

      const trigger = screen.getByRole("button", { name: "Método" });
      const select = trigger.parentElement?.querySelector("select");
      expect(select).not.toBeNull();
      expect(select).toHaveAttribute("aria-hidden", "true");
      expect(select).toHaveAttribute("name", "method");
      expect(select).toHaveValue("a");
    });

    it("reports the chosen value when the native select changes", () => {
      const onChange = vi.fn();
      render(<Select value="a" label="Método" options={baseOptions} onChange={onChange} />);

      const select = screen.getByRole("button", { name: "Método" }).parentElement!.querySelector("select")!;
      fireEvent.change(select, { target: { value: "b" } });

      expect(onChange).toHaveBeenCalledWith("b");
    });

    it("forwards required to the native select", () => {
      render(<Select value="" label="Empleado" required options={baseOptions} onChange={vi.fn()} />);

      const select = screen.getByRole("button", { name: "Empleado" }).parentElement!.querySelector("select")!;
      expect(select).toBeRequired();
    });
  });

  it("shows an error, marks the native field invalid and points the trigger at the message", () => {
    render(<Select value="a" label="Método" error="Elige un método" options={baseOptions} onChange={vi.fn()} />);

    const message = screen.getByText("Elige un método");
    const trigger = screen.getByRole("button", { name: "Método" });
    const select = trigger.parentElement!.querySelector("select")!;

    expect(message).toBeInTheDocument();
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAttribute("aria-describedby", message.id);
  });

  it("calls onChange with the value, not an event, when an option is clicked", () => {
    const onChange = vi.fn();
    render(<Select value="a" options={baseOptions} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: "Opción B" }));

    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("Select bottom sheet below sm", () => {
  afterEach(restoreMatchMedia);

  it("renders the options in a bottom sheet titled by the label", () => {
    stubSmBreakpoint(false);
    render(<Select value="" label="Categoría" options={baseOptions} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Categoría" }));

    const sheet = screen.getByRole("dialog", { name: "Categoría" });
    expect(sheet.closest("[data-select-sheet]")).not.toBeNull();
    expect(sheet.className).toContain("rounded-t-2xl");
    expect(sheet.className).toContain("pb-[var(--safe-bottom)]");

    const row = within(sheet).getByRole("option", { name: "Opción A" });
    expect(row.className).toContain("min-h-11");
    expect(row).toHaveAttribute("aria-selected", "false");
    expect(within(sheet).getByRole("listbox")).toBeInTheDocument();
  });

  it("reports the chosen value and closes the sheet", () => {
    stubSmBreakpoint(false);
    const onChange = vi.fn();
    render(<Select value="" label="Categoría" options={baseOptions} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Categoría" }));
    fireEvent.click(screen.getByRole("option", { name: "Opción B" }));

    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("focuses the current option and returns focus to the trigger on Escape", () => {
    stubSmBreakpoint(false);
    render(<Select value="b" label="Categoría" options={baseOptions} onChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Categoría" });
    fireEvent.click(trigger);

    const option = screen.getByRole("option", { name: "Opción B" });
    expect(option).toHaveFocus();
    expect(fireEvent.keyDown(option, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes the sheet when the overlay is tapped", () => {
    stubSmBreakpoint(false);
    render(<Select value="" label="Categoría" options={baseOptions} onChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Categoría" });
    fireEvent.click(trigger);

    fireEvent.click(document.querySelector("[data-bottom-sheet-scrim]")!);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps the hidden native select driving the same value while the sheet is open", () => {
    stubSmBreakpoint(false);
    const onChange = vi.fn();
    render(<Select value="a" label="Método" name="method" options={baseOptions} onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Método" });
    fireEvent.click(trigger);

    const select = trigger.parentElement!.querySelector("select")!;
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(select).toHaveValue("a");
    expect(select).toHaveAttribute("aria-hidden", "true");

    fireEvent.change(select, { target: { value: "b" } });

    expect(onChange).toHaveBeenCalledWith("b");
  });
});
