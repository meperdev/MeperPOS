import { afterEach, describe, expect, it, vi } from "vitest";

import {
  announceWaitingWorker,
  applyWaitingUpdate,
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

afterEach(() => {
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
