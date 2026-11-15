/**
 * The update handshake between the service worker and the page.
 *
 * A module-level store rather than a context, because a worker can finish
 * installing at any moment: the registrar and the banner live in different
 * subtrees, and neither should have to move a provider up the tree to tell the
 * other that a new version exists.
 *
 * The rule this store exists to enforce: a replacement worker never takes over
 * by itself. It becomes active only after `applyWaitingUpdate`, which is only
 * ever called from a button the operator pressed.
 *
 * The second rule, added after review: asking for the swap is not the same as
 * getting it. The request stays pending until the new worker actually takes
 * control, and a swap that never lands puts the offer back instead of leaving a
 * banner that vanished and old code still running.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** How long a swap request may stay unanswered before the offer returns. */
export const SWAP_TIMEOUT_MS = 10_000;

let waitingWorker: ServiceWorker | null = null;
let pendingSwap: ServiceWorker | null = null;
let reloadRequested = false;
let swapTimeout: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const listener of [...listeners]) listener();
}

function clearSwapTimeout() {
  if (swapTimeout === null) return;
  clearTimeout(swapTimeout);
  swapTimeout = null;
}

export function subscribeToSwUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Derived, never stored: two representations of one fact is how a banner and
 * its button end up disagreeing.
 */
export function getSwUpdateSnapshot(): boolean {
  return waitingWorker !== null;
}

/**
 * Nothing is waiting during prerender, and rendering an update offer into the
 * server HTML would show it to every client that has no worker at all.
 */
export function getSwUpdateServerSnapshot(): boolean {
  return false;
}

/** A replacement worker finished installing behind a live page. */
export function announceWaitingWorker(worker: ServiceWorker): void {
  if (waitingWorker === worker) return;
  waitingWorker = worker;
  emit();
}

/**
 * Asks the waiting worker to activate. Returns false when there is nothing to
 * swap, so a stale button cannot arm a reload that will never happen.
 *
 * Activating is not the same as being controlled by the new worker, so the
 * reload stays armed and the request stays pending until the registrar reports
 * `controllerchange` through `confirmWaitingUpdate`.
 */
export function applyWaitingUpdate(): boolean {
  if (!waitingWorker) return false;

  pendingSwap = waitingWorker;
  waitingWorker = null;
  reloadRequested = true;
  emit();

  // A worker that was already discarded, or one another tab got to first,
  // never answers. Without this the offer would be gone for the rest of the
  // page's life with no way back and no way to notice.
  clearSwapTimeout();
  swapTimeout = setTimeout(() => {
    swapTimeout = null;
    const worker = pendingSwap;
    pendingSwap = null;
    reloadRequested = false;
    if (worker) {
      waitingWorker = worker;
      emit();
    }
  }, SWAP_TIMEOUT_MS);

  pendingSwap.postMessage({ type: "SKIP_WAITING" });
  return true;
}

/**
 * The new worker took control. Cancels the watchdog and leaves the reload
 * armed, because the reload that follows is the one the operator asked for.
 */
export function confirmWaitingUpdate(): void {
  clearSwapTimeout();
  pendingSwap = null;
}

export function shouldReloadOnControllerChange(): boolean {
  return reloadRequested;
}

/**
 * Test seam. The store is a module singleton, so a test file would otherwise
 * carry state from one case into the next.
 */
export function resetSwUpdateStore(): void {
  clearSwapTimeout();
  waitingWorker = null;
  pendingSwap = null;
  reloadRequested = false;
  listeners.clear();
}
