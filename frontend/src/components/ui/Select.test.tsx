import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "@/components/ui/Select";

const baseOptions = [
  { value: "a", label: "Opción A" },
  { value: "b", label: "Opción B" },
];

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

  describe("open direction inside a scroll container", () => {
    const rects = new Map<string, Partial<DOMRect>>();

    const mockRects = () =>
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        // The select's own root is the only `relative w-full` element; the scroller is tagged.
        const key = this.hasAttribute("data-scroller")
          ? "scroller"
          : this.className.toString().includes("relative w-full")
            ? "select"
            : "";
        const rect = rects.get(key) ?? {};
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...rect } as DOMRect;
      });

    const renderInScroller = () =>
      render(
        <div data-scroller style={{ overflowY: "auto" }}>
          <Select value="" options={baseOptions} onChange={vi.fn()} />
        </div>,
      );

    it("opens upwards when the scroll container, not the window, has no room below", () => {
      // The window is 768px tall, but the modal's scroller ends 60px under the trigger.
      rects.set("scroller", { top: 0, bottom: 400 });
      rects.set("select", { top: 300, bottom: 340 });
      const spy = mockRects();
      renderInScroller();

      fireEvent.click(screen.getByRole("button"));

      const menu = screen.getByText("Opción A").closest(".absolute")!;
      expect(menu.className).toContain("bottom-full");
      spy.mockRestore();
    });

    it("opens downwards when the scroll container has room for the whole menu", () => {
      rects.set("scroller", { top: 0, bottom: 700 });
      rects.set("select", { top: 100, bottom: 140 });
      const spy = mockRects();
      renderInScroller();

      fireEvent.click(screen.getByRole("button"));

      const menu = screen.getByText("Opción A").closest(".absolute")!;
      expect(menu.className).toContain("top-full");
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
