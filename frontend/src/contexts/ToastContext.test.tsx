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
      <button onClick={() => toast.warning("cuidado")}>warning</button>
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
      <button onClick={() => toast.success("subido", { description: "Se guardó el archivo" })}>
        described
      </button>
      <button onClick={() => toast.error("subida falló", { action: { label: "Reintentar", onClick: () => {} } })}>
        with action
      </button>
      <button onClick={() => toast.success("con acción", { action: { label: "Reintentar", onClick: () => {} } })}>
        success with action
      </button>
    </div>
  );
}

function renderHarness() {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

describe("toast smoke", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("caps the stack at three and refreshes duplicates", () => {
    renderHarness();
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
    renderHarness();
    fireEvent.click(screen.getByText("success"));
    fireEvent.click(screen.getByText("success"));
    act(() => vi.advanceTimersByTime(20));

    expect(screen.getAllByText("guardado")).toHaveLength(1);
  });

  it("pauses the countdown while hovered", () => {
    renderHarness();
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
    renderHarness();
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

describe("toast API", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("offers a warning level with its own tile", () => {
    renderHarness();
    fireEvent.click(screen.getByText("warning"));
    act(() => vi.advanceTimersByTime(20));

    const card = screen.getByText("cuidado").closest("[data-testid='toast-card']")!;
    expect(card).not.toBeNull();
    expect(screen.getByTestId("toast-icon-tile").className).toContain("bg-toast-warning");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("takes an options object and still accepts a bare number as duration", () => {
    renderHarness();
    fireEvent.click(screen.getByText("described"));
    act(() => vi.advanceTimersByTime(20));
    expect(screen.getByText("Se guardó el archivo")).toBeInTheDocument();

    fireEvent.click(screen.getByText("short"));
    act(() => vi.advanceTimersByTime(20));
    // 1000ms as a number still means the duration, not a description.
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByText("corto")).toBeNull();
  });

  it("dedupes on title plus description", () => {
    renderHarness();
    fireEvent.click(screen.getByText("described"));
    fireEvent.click(screen.getByText("described"));
    act(() => vi.advanceTimersByTime(20));

    expect(screen.getAllByText("subido")).toHaveLength(1);
    expect(screen.getAllByText("Se guardó el archivo")).toHaveLength(1);
  });

  it("holds an error longer than a success", () => {
    renderHarness();
    fireEvent.click(screen.getByText("error"));
    fireEvent.click(screen.getByText("success"));

    act(() => vi.advanceTimersByTime(4200));
    expect(screen.queryByText("guardado")).toBeNull();
    expect(screen.getByText("falló")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText("falló")).toBeNull();
  });

  it("never auto-dismisses a toast with an action before eight seconds", () => {
    renderHarness();
    fireEvent.click(screen.getByText("success with action"));

    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText("con acción")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByText("con acción")).toBeNull();
  });

  it("runs the action and dismisses the toast", () => {
    renderHarness();
    fireEvent.click(screen.getByText("with action"));
    act(() => vi.advanceTimersByTime(20));

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByText("subida falló")).toBeNull();
  });

  it("keeps the stack open while hovered and resumes everything on leave", () => {
    renderHarness();
    fireEvent.click(screen.getByText("burst"));
    act(() => vi.advanceTimersByTime(20));

    const stack = screen.getByTestId("toast-stack");
    fireEvent.mouseEnter(stack);
    expect(stack.dataset.expanded).toBe("true");

    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText("cuatro")).toBeInTheDocument();

    fireEvent.mouseLeave(stack);
    expect(stack.dataset.expanded).toBe("false");
    act(() => vi.advanceTimersByTime(4200));
    expect(screen.queryByText("cuatro")).toBeNull();
  });
});
