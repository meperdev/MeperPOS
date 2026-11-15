import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SWAP_TIMEOUT_MS,
  announceWaitingWorker,
  applyWaitingUpdate,
  confirmWaitingUpdate,
  getSwUpdateSnapshot,
  resetSwUpdateStore,
  shouldReloadOnControllerChange,
  subscribeToSwUpdate,
} from "./sw-update";

function fakeWorker() {
  return { postMessage: vi.fn() } as unknown as ServiceWorker & {
    postMessage: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetSwUpdateStore();
  vi.restoreAllMocks();
});

describe("sw update store", () => {
  it("starts with no update available", () => {
    expect(getSwUpdateSnapshot()).toBe(false);
    expect(shouldReloadOnControllerChange()).toBe(false);
  });

  it("notifies subscribers once when a worker starts waiting", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSwUpdate(listener);

    announceWaitingWorker(fakeWorker());

    expect(getSwUpdateSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("does not re-notify for the same waiting worker", () => {
    const listener = vi.fn();
    subscribeToSwUpdate(listener);
    const worker = fakeWorker();

    announceWaitingWorker(worker);
    announceWaitingWorker(worker);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after a subscriber unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSwUpdate(listener);
    unsubscribe();

    announceWaitingWorker(fakeWorker());

    expect(listener).not.toHaveBeenCalled();
  });

  it("asks the waiting worker for the swap exactly once", () => {
    const worker = fakeWorker();
    announceWaitingWorker(worker);

    expect(applyWaitingUpdate()).toBe(true);

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(getSwUpdateSnapshot()).toBe(false);
  });

  it("arms the reload only when the operator asked for the swap", () => {
    // First install: `clients.claim()` also fires `controllerchange`, and
    // reloading a page nobody asked to reload would look like a crash.
    expect(shouldReloadOnControllerChange()).toBe(false);

    announceWaitingWorker(fakeWorker());
    expect(shouldReloadOnControllerChange()).toBe(false);

    applyWaitingUpdate();
    expect(shouldReloadOnControllerChange()).toBe(true);
  });

  it("ignores a swap request with no waiting worker", () => {
    expect(applyWaitingUpdate()).toBe(false);
    expect(shouldReloadOnControllerChange()).toBe(false);
  });
});

describe("sw update store — a swap that never lands", () => {
  it("keeps the offer while the swap is in flight", () => {
    announceWaitingWorker(fakeWorker());
    applyWaitingUpdate();

    // Not yet confirmed: the offer is gone from the banner, but the request is
    // still open, so nothing has been declared finished.
    expect(getSwUpdateSnapshot()).toBe(false);
    expect(shouldReloadOnControllerChange()).toBe(true);
  });

  it("puts the offer back when the worker never takes control", () => {
    const worker = fakeWorker();
    announceWaitingWorker(worker);
    applyWaitingUpdate();

    vi.advanceTimersByTime(SWAP_TIMEOUT_MS);

    // The banner vanishing with, old code still running is the failure this
    // covers: the operator gets the offer back instead of a silent dead end.
    expect(getSwUpdateSnapshot()).toBe(true);
    expect(shouldReloadOnControllerChange()).toBe(false);
  });

  it("does not arm a reload after the swap timed out", () => {
    announceWaitingWorker(fakeWorker());
    applyWaitingUpdate();
    vi.advanceTimersByTime(SWAP_TIMEOUT_MS);

    // An armed flag that never expires would reload a page nobody asked to
    // reload, mid-sale, on some later controllerchange.
    expect(shouldReloadOnControllerChange()).toBe(false);
  });

  it("stops the timer once the swap is confirmed", () => {
    announceWaitingWorker(fakeWorker());
    applyWaitingUpdate();
    confirmWaitingUpdate();

    vi.advanceTimersByTime(SWAP_TIMEOUT_MS);

    expect(getSwUpdateSnapshot()).toBe(false);
  });

  it("keeps the operator's reload armed after a confirmation", () => {
    announceWaitingWorker(fakeWorker());
    applyWaitingUpdate();
    confirmWaitingUpdate();

    expect(shouldReloadOnControllerChange()).toBe(true);
  });

  it("allows a second attempt after a failed swap", () => {
    const worker = fakeWorker();
    announceWaitingWorker(worker);
    applyWaitingUpdate();
    vi.advanceTimersByTime(SWAP_TIMEOUT_MS);

    expect(applyWaitingUpdate()).toBe(true);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
  });
});
