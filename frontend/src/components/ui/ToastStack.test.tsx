import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastStack, type ToastStackItem } from "./ToastStack";

function item(id: string, overrides: Partial<ToastStackItem> = {}): ToastStackItem {
  return { id, type: "info", title: id, leaving: false, ...overrides };
}

const noop = () => {};

function renderStack(toasts: ToastStackItem[], handlers: Partial<Parameters<typeof ToastStack>[0]> = {}) {
  return render(
    <ToastStack toasts={toasts} onDismiss={noop} onPauseAll={noop} onResumeAll={noop} {...handlers} />,
  );
}

describe("ToastStack", () => {
  it("labels the live region and never shows more than three cards", () => {
    renderStack([item("cuatro"), item("tres"), item("dos"), item("uno")]);

    expect(screen.getByRole("region", { name: "Notificaciones" })).toBeInTheDocument();
    expect(screen.getAllByTestId("toast-card")).toHaveLength(3);
    expect(screen.queryByText("uno")).toBeNull();
    expect(screen.getByText("cuatro")).toBeInTheDocument();
  });

  it("stacks the newest card in front and peeks the next two behind it", () => {
    renderStack([item("cuatro"), item("tres"), item("dos")]);
    const stack = screen.getByTestId("toast-stack");
    const cards = screen.getAllByTestId("toast-card");

    expect(stack.dataset.expanded).toBe("false");
    expect(cards[0].className).toContain("relative");
    expect(cards[1].className).toContain("absolute");
    expect(cards[1].style.transform).toContain("translateY(8px)");
    expect(cards[1].style.transform).toContain("scale(0.95)");
    expect(cards[2].style.transform).toContain("translateY(16px)");
    expect(cards[2].style.transform).toContain("scale(0.9)");
    expect(Number(cards[1].style.opacity)).toBeLessThan(1);
  });

  it("sits under the desktop header and below the mobile one", () => {
    renderStack([item("uno")]);
    const region = screen.getByRole("region", { name: "Notificaciones" });

    expect(region.className).toContain("lg:top-[calc(var(--app-header-height)+12px)]");
    expect(region.className).toContain(
      "top-[calc(var(--mobile-header)+var(--safe-top)+0.5rem)]",
    );
  });

  it("expands into a list on hover and pauses every timer, then collapses on leave", () => {
    const onPauseAll = vi.fn();
    const onResumeAll = vi.fn();
    renderStack([item("tres"), item("dos"), item("uno")], { onPauseAll, onResumeAll });

    const stack = screen.getByTestId("toast-stack");
    fireEvent.mouseEnter(stack);

    expect(stack.dataset.expanded).toBe("true");
    expect(stack.className).toContain("gap-2");
    expect(screen.getAllByTestId("toast-card")[1].className).not.toContain("absolute");
    expect(onPauseAll).toHaveBeenCalledTimes(1);

    fireEvent.mouseLeave(stack);

    expect(stack.dataset.expanded).toBe("false");
    expect(onResumeAll).toHaveBeenCalledTimes(1);
  });

  it("expands when keyboard focus lands inside the stack", () => {
    renderStack([item("dos"), item("uno")]);

    const stack = screen.getByTestId("toast-stack");
    const close = screen.getAllByRole("button", { name: "Cerrar notificación" })[0];
    fireEvent.focus(close);

    expect(stack.dataset.expanded).toBe("true");
    expect(screen.getAllByTestId("toast-card")[1].className).not.toContain("absolute");
  });

  it("expands on a tap, which is what a touch device has", () => {
    renderStack([item("dos"), item("uno")]);
    const stack = screen.getByTestId("toast-stack");

    fireEvent.click(stack);
    expect(stack.dataset.expanded).toBe("true");

    fireEvent.click(stack);
    expect(stack.dataset.expanded).toBe("false");
  });

  it("dismisses the front toast on Escape", () => {
    const onDismiss = vi.fn();
    renderStack([item("nuevo"), item("viejo")], { onDismiss });

    fireEvent.keyDown(screen.getByTestId("toast-stack"), { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledWith("nuevo");
  });

  it("keeps a click on the close button from toggling the stack open", () => {
    const onDismiss = vi.fn();
    renderStack([item("uno")], { onDismiss });

    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));

    expect(onDismiss).toHaveBeenCalledWith("uno");
    expect(screen.getByTestId("toast-stack").dataset.expanded).toBe("false");
  });
});
