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
});
