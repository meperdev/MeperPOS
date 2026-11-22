"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { shouldAutoFocusTextInput } from "@/lib/input-focus";
import { useBelowSmViewport, useVisualViewport } from "@/hooks/useVisualViewport";

/** Drag distance that commits a sheet dismissal. */
const SHEET_DISMISS_PX = 100;
/** A quick flick counts below that distance: distance alone reads as stuck. */
const SHEET_FLICK_PX = 40;
const SHEET_FLICK_MS = 300;

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Accessible name when the dialog renders its own heading instead of `title`. */
  ariaLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  /** Opt out only when the consumer measures and fits its content to the viewport. */
  scrollContent?: boolean;
  /** Set false when the step must be answered: the sheet cannot be dragged away. */
  dismissible?: boolean;
  className?: string;
}


const sizes = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  "2xl": "max-w-7xl",
};

export function Modal({
  isOpen,
  onClose,
  title,
  ariaLabel,
  children,
  footer,
  size = "md",
  scrollContent = true,
  dismissible = true,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Below `sm` the dialog becomes a bottom sheet that owns the bottom edge.
  const sheet = useBelowSmViewport();
  // iOS keeps the layout viewport whole and shrinks the visual one, so the
  // sheet has to lift itself by whatever the keyboard covers. A closed modal
  // renders nothing, so it also listens to nothing.
  const keyboardInset = useVisualViewport(isOpen);
  const drag = useRef<{ startY: number; startedAt: number } | null>(null);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "unset";
    return () => { document.body.style.overflow = "unset"; };
  }, [isOpen]);

  // Modal dialogs own the keyboard: focus moves in, Tab stays inside, and the
  // element that opened the dialog gets focus back when it closes.
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const previous = document.activeElement as HTMLElement | null;

    // Visibility by style rather than layout rects: rects are empty until the
    // browser lays out, and never exist at all under jsdom.
    const isReachable = (element: HTMLElement) => {
      if (element.closest("[hidden]")) return false;
      // A control inside a disabled fieldset is disabled without carrying the
      // attribute itself, and focusing it silently does nothing.
      if (element.closest("fieldset:disabled")) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };

    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter(
        (element) =>
          isReachable(element) &&
          element.tabIndex >= 0 &&
          !(element as HTMLButtonElement).disabled,
      );

    // The first field wins over the close button: opening a form should land on
    // the form, not on the way out of it. A consumer can name the control that
    // should receive focus, so a destructive action is never the default.
    const initialTarget = () => {
      const body = panel?.querySelector<HTMLElement>("[data-modal-content]");
      const inBody = body
        ? Array.from(
            body.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter(
            (element) =>
              isReachable(element) &&
              element.tabIndex >= 0 &&
              !(element as HTMLButtonElement).disabled,
          )
        : [];
      const marked = body?.querySelector<HTMLElement>("[data-modal-autofocus]");
      if (marked && isReachable(marked) && marked.tabIndex >= 0) return marked;
      return inBody[0] ?? focusables()[0] ?? null;
    };

    // A touch device must not receive its keyboard the moment a dialog opens:
    // the way out (or the dialog itself) takes the focus instead, so the reader
    // sees the form before deciding to type in it.
    const defaultFocusTarget = () =>
      shouldAutoFocusTextInput()
        ? (initialTarget() ?? panel)
        : (panel?.querySelector<HTMLElement>("[data-modal-close]") ?? panel);

    const focusInitial = () => {
      defaultFocusTarget()?.focus();
    };
    // Focus immediately for deterministic behaviour, then again after layout so
    // a field that mounts late still receives it.
    focusInitial();
    const frame = window.requestAnimationFrame(focusInitial);

    // Programmatic focus can escape a dialog; bring it back instead of leaving
    // the keyboard user on the page behind it.
    const handleFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || !panel) return;
      if (panel.contains(event.target)) return;
      // A Select inside the dialog portals its list to `document.body` (as a
      // bottom sheet below `sm` or a fixed popover above `sm`); while it is
      // open the options own focus, and yanking it back would also send Escape
      // to the dialog instead of the list.
      const nested = event.target instanceof Element
        ? event.target.closest("[data-select-sheet], [data-select-popover]")
        : null;
      if (nested && panel.querySelector('[data-select-trigger][aria-expanded="true"]')) {
        return;
      }
      defaultFocusTarget()?.focus();
    };

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTab);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleTab);
      document.removeEventListener("focusin", handleFocusIn);
      previous?.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Dragging the handle (or the header behind it) moves the sheet with the
  // finger; letting go past the threshold dismisses it and anything shorter
  // snaps back. Nothing here runs at `sm` and up, where the panel is centred.
  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!sheet || !dismissible) return;
    // A press on the close button is a tap, not a drag.
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    drag.current = { startY: event.clientY, startedAt: Date.now() };
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    const panel = panelRef.current;
    if (!current || !panel) return;
    const offset = Math.max(0, event.clientY - current.startY);
    panel.style.transition = "none";
    panel.style.transform = `translateY(${offset}px)`;
  };

  const snapBack = () => {
    drag.current = null;
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = "";
    panel.style.transform = "";
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    const panel = panelRef.current;
    if (!current) return;
    if (!panel) {
      drag.current = null;
      return;
    }
    const offset = Math.max(0, event.clientY - current.startY);
    const flicked =
      Date.now() - current.startedAt < SHEET_FLICK_MS && offset > SHEET_FLICK_PX;
    if (offset > SHEET_DISMISS_PX || flicked) {
      drag.current = null;
      // Leave the sheet where the finger left it; it unmounts from here.
      onClose();
      return;
    }
    snapBack();
  };

  const dragHandlers = sheet
    ? {
        onPointerDown: beginDrag,
        onPointerMove: moveDrag,
        onPointerUp: endDrag,
        onPointerCancel: snapBack,
      }
    : {};

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        sheet
          ? "flex-col justify-end"
          : "items-center justify-center p-[max(0.75rem,var(--safe-top))_max(0.75rem,var(--safe-right))_max(0.75rem,var(--safe-bottom))_max(0.75rem,var(--safe-left))] sm:p-6 md:p-8",
      )}
      style={sheet && keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
        data-presentation={sheet ? "sheet" : "dialog"}
        style={
          sheet
            ? // The `min()` keeps the cap honest while the keyboard lifts the
              // sheet: a 100dvh sheet would otherwise grow past the visible part.
              { maxHeight: "min(calc(100dvh - var(--safe-top) - 0.75rem), 100%)" }
            : undefined
        }
        className={cn(
          "relative w-full border border-border bg-card shadow-lg shadow-black/10 flex flex-col",
          sheet
            ? "rounded-t-2xl border-x-0 border-b-0 animate-sheet-up transition-transform duration-200 pb-[var(--safe-bottom)]"
            : "rounded-xl sm:rounded-2xl animate-fade-in max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] md:max-h-[calc(100dvh-4rem)]",
          !sheet && sizes[size],
          className,
          sheet && "max-w-none",
        )}
      >
        {/* Drag handle: decorative, the whole header is the drag surface too. */}
        {sheet && (
          <div
            data-sheet-handle
            aria-hidden="true"
            className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5 active:cursor-grabbing"
            {...dragHandlers}
          >
            <span className="h-1 w-10 rounded-full bg-border" />
          </div>
        )}

        {/* Header */}
        {title && (
          <div
            className={cn(
              "flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-6 sm:py-4 shrink-0",
              sheet && "touch-none",
            )}
            {...dragHandlers}
          >
            <h2 id={titleId} className={cn("text-base font-semibold text-foreground pr-2", scrollContent ? "truncate" : "min-w-0 [overflow-wrap:anywhere]")}>{title}</h2>
            <button
              type="button"
              onClick={onClose}
              data-modal-close
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background sm:h-9 sm:w-9"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Content */}
        <div
          data-modal-content
          className={cn("p-4 sm:p-6", scrollContent ? "overflow-y-auto scrollbar-app flex-1" : "shrink-0")}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className={cn("border-t border-border/60 px-4 py-3 sm:px-6 sm:py-3.5 bg-muted/10 shrink-0", sheet ? "rounded-none" : "rounded-b-xl sm:rounded-b-2xl")}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
