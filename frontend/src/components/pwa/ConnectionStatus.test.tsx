import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ConnectionStatus } from "./ConnectionStatus";

/**
 * jsdom has no network, so `navigator.onLine` is driven from the test. The
 * events are dispatched for real, which is the point: the component must react
 * to the browser's own signal, not to a prop or a poll.
 */
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

function dispatchOnlineStatus(type: "online" | "offline") {
  act(() => {
    window.dispatchEvent(new Event(type));
  });
}

describe("ConnectionStatus", () => {
  beforeEach(() => {
    setOnline(true);
  });

  afterEach(() => {
    cleanup();
    setOnline(true);
  });

  it("renders nothing while the browser reports a connection", () => {
    render(<ConnectionStatus />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("warns that data may be stale when the browser goes offline", () => {
    render(<ConnectionStatus />);

    setOnline(false);
    dispatchOnlineStatus("offline");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Sin conexión. Los datos que ves pueden estar desactualizados."
    );
  });

  it("clears the warning when the connection comes back", () => {
    setOnline(false);
    render(<ConnectionStatus />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    setOnline(true);
    dispatchOnlineStatus("online");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  /**
   * The copy is the specification here: there is no write queue in this branch,
   * so the banner must not imply that a sale is waiting to be sent. A future
   * queue can change this test on purpose, not by accident.
   */
  it("never claims that anything is queued or synchronized", () => {
    setOnline(false);
    render(<ConnectionStatus />);

    const banner = screen.getByRole("status");
    expect(banner).not.toHaveTextContent(/sincroniz|guardad|pendiente|cola/i);
  });

  it("does not render the warning in the prerendered HTML", () => {
    setOnline(false);

    const html = renderToString(<ConnectionStatus />);

    expect(html).toBe("");
  });
});
