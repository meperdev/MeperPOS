import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./ToastContext";

function Harness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success("guardado")}>success</button>
      <button onClick={() => toast.error("falló")}>error</button>
      <button onClick={() => toast.info("dato")}>info</button>
      <button
        onClick={() => {
          toast.info("uno");
          toast.info("dos");
          toast.info("tres");
          toast.info("cuatro");
        }}
      >
        burst
      </button>
      <button onClick={() => toast.info("corto", 1000)}>short</button>
    </div>
  );
}

describe("toast smoke", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("caps the stack at three and refreshes duplicates", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("burst"));
    act(() => vi.advanceTimersByTime(250));

    const visible =
      screen.queryAllByRole("status").length + screen.queryAllByRole("alert").length;
    expect(visible).toBe(3);
    expect(screen.queryByText("uno")).toBeNull();
    expect(screen.getByText("dos")).toBeInTheDocument();
    expect(screen.getByText("cuatro")).toBeInTheDocument();
  });

  it("shows one card for a repeated message", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("success"));
    fireEvent.click(screen.getByText("success"));
    act(() => vi.advanceTimersByTime(20));

    expect(screen.getAllByText("guardado")).toHaveLength(1);
  });

  it("pauses the countdown while hovered", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("short"));
    act(() => vi.advanceTimersByTime(600));

    const card = screen.getByText("corto").closest("[role]")!;
    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText("corto")).toBeInTheDocument();

    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(450));
    expect(screen.queryByText("corto")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("corto")).toBeNull();
  });

  it("uses alert for errors and status for the rest", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("error"));
    fireEvent.click(screen.getByText("info"));
    act(() => vi.advanceTimersByTime(20));

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("pins the close button to the top-right corner of the card", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("success"));
    act(() => vi.advanceTimersByTime(20));

    const button = screen.getByRole("button", { name: "Cerrar notificación" });
    const card = button.closest("[role]") as HTMLElement;

    // Inside the card, anchored to its top-right corner, and at least a 32px
    // hit target with the shared focus ring.
    expect(card.contains(button)).toBe(true);
    expect(button.className).toContain("absolute");
    expect(button.className).toContain("right-1");
    expect(button.className).toContain("top-1");
    expect(button.className).toContain("h-8");
    expect(button.className).toContain("w-8");
    expect(button.className).toContain("focus-visible:ring-2");
    // A long message wraps before the button instead of running under it.
    expect(card.className).toContain("pr-11");
  });

  it("dismisses the notification from that close button", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("success"));
    act(() => vi.advanceTimersByTime(20));

    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByText("guardado")).toBeNull();
  });
});
