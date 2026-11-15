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
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let waitingWorker: ServiceWorker | null = null;
let updateAvailable = false;
let reloadRequested = false;

function emit() {
  for (const listener of [...listeners]) listener();
}

export function subscribeToSwUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSwUpdateSnapshot(): boolean {
  return updateAvailable;
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
  waitingWorker = worker;
  if (updateAvailable) return;
  updateAvailable = true;
  emit();
}

/**
 * Asks the waiting worker to activate. Returns false when there is nothing to
 * swap, so a stale button cannot arm a reload that will never happen.
 *
 * Activating is not the same as being controlled by the new worker, so the
 * reload is armed here and fired by the registrar on `controllerchange`.
 */
export function applyWaitingUpdate(): boolean {
  if (!waitingWorker) return false;

  const worker = waitingWorker;
  waitingWorker = null;
  updateAvailable = false;
  reloadRequested = true;
  emit();
  worker.postMessage({ type: "SKIP_WAITING" });
  return true;
}

export function shouldReloadOnControllerChange(): boolean {
  return reloadRequested;
}

/**
 * Test seam. The store is a module singleton, so a test file would otherwise
 * carry state from one case into the next.
 */
export function resetSwUpdateStore(): void {
  waitingWorker = null;
  updateAvailable = false;
  reloadRequested = false;
  listeners.clear();
}
