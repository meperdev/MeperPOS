"use client";

/**
 * Loading shell for the lazily loaded expense modals.
 *
 * The shared `DynamicFallback` renders in the page flow, so the first open of a
 * modal in a session inserted a block of loading content directly under the
 * pager before the dialog replaced it. This shell is the modal's own fixed,
 * full-viewport overlay instead: it can never take space in the layout, and its
 * backdrop is the one the dialog will draw.
 *
 * The message is delayed: a chunk that is already prefetched arrives before the
 * delay is over, so nothing flashes over the page. Only a genuinely slow load
 * says it is still working.
 */
export function ExpenseModalFallback() {
  return (
    <div data-testid="expense-modal-fallback" className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          role="status"
          aria-live="polite"
          // Inline delay: the `animate-fade-in` shorthand would zero a utility
          // delay, and the message must not flash for a chunk that is ready.
          style={{ animationDelay: "400ms" }}
          className="animate-fade-in flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-2xs"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-b-transparent"
          />
          <span className="text-[13px] text-muted-foreground">Cargando…</span>
        </div>
      </div>
    </div>
  );
}
