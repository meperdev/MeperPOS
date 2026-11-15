import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";

import { UpdateAvailableBanner } from "./UpdateAvailableBanner";
import {
  announceWaitingWorker,
  resetSwUpdateStore,
} from "@/lib/sw-update";

function fakeWorker() {
  return { postMessage: vi.fn() } as unknown as ServiceWorker & {
    postMessage: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  cleanup();
  resetSwUpdateStore();
  vi.restoreAllMocks();
});

describe("UpdateAvailableBanner", () => {
  it("stays out of the way when no update is waiting", () => {
    render(<UpdateAvailableBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers the reload once a new worker is waiting", () => {
    render(<UpdateAvailableBanner />);

    act(() => {
      announceWaitingWorker(fakeWorker());
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Nueva versión disponible"
    );
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument();
  });

  it("asks the waiting worker for the swap when the operator chooses reload", async () => {
    const worker = fakeWorker();
    render(<UpdateAvailableBanner />);

    act(() => {
      announceWaitingWorker(worker);
    });

    await userEvent.click(screen.getByRole("button", { name: "Recargar" }));

    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("disappears after the swap is requested", async () => {
    render(<UpdateAvailableBanner />);
    act(() => {
      announceWaitingWorker(fakeWorker());
    });

    await userEvent.click(screen.getByRole("button", { name: "Recargar" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  /**
   * The offer must not arrive before the operator can act on it: a quick reload
   * mid-checkout is the failure this whole design exists to avoid.
   */
  it("tells the operator to finish the sale in progress first", () => {
    render(<UpdateAvailableBanner />);
    act(() => {
      announceWaitingWorker(fakeWorker());
    });

    expect(screen.getByRole("status")).toHaveTextContent(/termina la venta/i);
  });

  it("does not render in the prerendered HTML", () => {
    announceWaitingWorker(fakeWorker());
    expect(renderToString(<UpdateAvailableBanner />)).toBe("");
  });
});
