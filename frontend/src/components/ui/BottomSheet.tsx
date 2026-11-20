"use client";

import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Fraction of its own height a drag has to cover before letting go dismisses. */
const DISMISS_RATIO = 0.3;
/** Downward speed that dismisses on its own, in px per ms. A slow pull is not a flick. */
const DISMISS_VELOCITY = 0.5;
/** The pull has to be this long before its speed can count as a flick. */
const FLICK_MIN_PX = 24;
/** Movement before the sheet starts following: less than this is a tap or a scroll. */
const DRAG_START_PX = 6;
/** Spring-back and height-change duration. Kept in step with the panel's classes. */
const MOTION_MS = 220;
const HEIGHT_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DragState {
  startY: number;
  startedAt: number;
  offset: number;
}

function subscribeToReducedMotion(onStoreChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener?.("change", onStoreChange);
  return () => query.removeEventListener?.("change", onStoreChange);
}

function hasReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/**
 * The reader's motion preference, live: it can be flipped mid-session. The
 * server has none, so it answers "motion" and the first client frame corrects it.
 */
function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeToReducedMotion, hasReducedMotion, () => false);
}

/*
 * One page-level counter for every open sheet. Two overlays can be open at once
 * (a sheet opened from a dialog), and the inner one closing must not hand the
 * page its scroll back while the outer one still covers it. The value the page
 * had before the first lock is what gets restored, so a lock owned by something
 * else — a Modal — survives ours.
 */
let bodyScrollLocks = 0;
let overflowBeforeLock: string | null = null;

function lockBodyScroll(): () => void {
  if (bodyScrollLocks === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLocks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
    if (bodyScrollLocks === 0) {
      document.body.style.overflow = overflowBeforeLock || "unset";
      overflowBeforeLock = null;
    }
  };
}

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Visible heading, and the name the dialog answers to. */
  title: string;
  /** Quiet second line under the title: a count, a hint. */
  subtitle?: string;
  /** Trailing control in the header, placed before the close button. */
  headerAction?: ReactNode;
  /** Pinned to the bottom edge, outside the scrolling body. */
  footer?: ReactNode;
  children: ReactNode;
  closeLabel?: string;
  showCloseButton?: boolean;
  /**
   * Type override for the heading. A drawer that owns a task sets its title at
   * full weight; the default is the quiet caption a chooser uses.
   */
  titleClassName?: string;
  bodyClassName?: string;
  /** Extra classes for the portal root, where the host scopes the sheet (a breakpoint, a layer). */
  className?: string;
  /**
   * Where focus goes when the sheet closes, when that is not the control that
   * opened it. A Select hands focus back to its own trigger, which it owns.
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /**
   * `data-*` attributes for hosts that find the sheet by its role in the DOM:
   * the Modal focus trap lets focus live inside `[data-select-sheet]`.
   */
  portalProps?: Record<`data-${string}`, string | undefined>;
}

/**
 * A sheet welded to the bottom edge, for phones.
 *
 * The shell owns what every sheet needs and nothing a caller should repeat: the
 * portal, the scrim, the grab handle, the safe-area padding, the scroll lock,
 * the focus trap, Escape, and the drag that dismisses it. The caller keeps its
 * own content, state and actions: the header line, the scrolling body and the
 * pinned footer are slots.
 *
 * Height is left to the content, so a view that changes (an empty cart, a
 * shorter list) would normally jump. A ResizeObserver measures the panel and a
 * WAAPI animation carries the old height to the new one, which keeps the body
 * itself auto and its scrolling untouched.
 */
export function BottomSheet({
  isOpen,
  onClose,
  title,
  subtitle,
  headerAction,
  footer,
  children,
  closeLabel = "Cerrar",
  showCloseButton = true,
  titleClassName,
  bodyClassName,
  className,
  returnFocusTo,
  portalProps,
}: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();
  const dragRef = useRef<DragState | null>(null);
  const heightAnimationRef = useRef<Animation | null>(null);
  const lastHeightRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    return lockBodyScroll();
  }, [isOpen]);

  // Escape belongs to the topmost surface. A nested control that closes on it
  // (the Select list inside a sheet) prevents the default first, and then this
  // listener stays out of the way.
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Focus moves in, Tab stays inside, and the control that opened the sheet gets
  // focus back when it closes.
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Read the named target once, while it is still mounted: the cleanup would
    // otherwise read it after the host may have replaced it.
    const namedTarget = returnFocusTo?.current ?? null;

    // Visibility by style rather than layout rects: rects are empty until the
    // browser lays out, and never exist at all under jsdom.
    const isReachable = (element: HTMLElement) => {
      if (element.closest("[hidden]")) return false;
      if (element.closest("fieldset:disabled")) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };

    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => isReachable(element) && element.tabIndex >= 0,
      );

    panel?.focus();

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      // Focus already left on purpose (a Select's Tab closes the sheet and
      // returns to its trigger): leave the default navigation alone.
      if (!active || !panel?.contains(active)) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || !panel) return;
      if (panel.contains(event.target)) return;
      panel.focus();
    };

    document.addEventListener("keydown", handleTab);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("keydown", handleTab);
      document.removeEventListener("focusin", handleFocusIn);
      // The host may have moved focus somewhere on purpose while closing (a
      // Select hands it back to its trigger). Only a sheet that still owns the
      // focus — or lost it to nowhere — gives it back.
      const active = document.activeElement;
      const ownsFocus =
        !active ||
        active === document.body ||
        !document.contains(active) ||
        Boolean(panel?.contains(active));
      const target = namedTarget ?? opener;
      if (ownsFocus && target && document.contains(target)) target.focus();
    };
  }, [isOpen, returnFocusTo]);

  // A view switch inside the sheet (the cart emptying, a shorter list) changes
  // the panel's height in one commit. Carrying the old height into the new one
  // keeps the bottom edge still while the top edge settles.
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;

    lastHeightRef.current = null;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      const running = heightAnimationRef.current;
      // The frames of our own animation are not a content change.
      if (running && running.playState === "running") return;

      const previous = lastHeightRef.current;
      lastHeightRef.current = height;
      if (previous === null || Math.abs(height - previous) < 1) return;
      if (prefersReducedMotion || typeof panel.animate !== "function") return;

      heightAnimationRef.current?.cancel();
      heightAnimationRef.current = panel.animate(
        [{ height: `${previous}px` }, { height: `${height}px` }],
        { duration: MOTION_MS, easing: HEIGHT_EASE },
      );
    });
    observer.observe(panel);

    return () => {
      observer.disconnect();
      heightAnimationRef.current?.cancel();
      heightAnimationRef.current = null;
      lastHeightRef.current = null;
    };
  }, [isOpen, prefersReducedMotion]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>, source: "handle" | "body") => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // A press on a control is a press on that control, never a drag.
    if (target?.closest("button, a, input, select, textarea")) return;
    // The body already scrolls: a gesture inside it only belongs to the sheet
    // once there is nothing left to scroll towards.
    if (source === "body" && (bodyRef.current?.scrollTop ?? 0) > 0) return;

    dragRef.current = { startY: event.clientY, startedAt: performance.now(), offset: 0 };

    // Touch keeps its own pointer stream; capturing it would fight the scroll.
    if (event.pointerType !== "touch") {
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // jsdom and old webviews have no pointer capture. The sheet still drags.
      }
    }
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;

    const offset = event.clientY - drag.startY;
    if (offset <= 0) {
      if (drag.offset > 0) {
        drag.offset = 0;
        panel.style.transform = "";
      }
      return;
    }
    if (drag.offset === 0 && offset < DRAG_START_PX) return;

    drag.offset = offset;
    panel.style.transition = "none";
    panel.style.transform = `translateY(${offset}px)`;
  };

  const settleDrag = (cancelled: boolean) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    dragRef.current = null;
    if (!drag || !panel) return;

    const height = panel.getBoundingClientRect().height;
    const elapsed = Math.max(1, performance.now() - drag.startedAt);
    const flicked = drag.offset >= FLICK_MIN_PX && drag.offset / elapsed > DISMISS_VELOCITY;
    const pulled = height > 0 && drag.offset > height * DISMISS_RATIO;

    if (!cancelled && (pulled || flicked)) {
      // The sheet leaves from where the finger let it go; the host unmounts it.
      onClose();
      return;
    }

    // Inside the threshold the panel springs back on its own class transition,
    // which reduced motion already shortens to nothing.
    panel.style.transition = "";
    panel.style.transform = "";
  };

  const dragHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startDrag(event, "handle"),
    onPointerMove: moveDrag,
    onPointerUp: () => settleDrag(false),
    onPointerCancel: () => settleDrag(true),
  };

  const bodyDragHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startDrag(event, "body"),
    onPointerMove: moveDrag,
    onPointerUp: () => settleDrag(false),
    onPointerCancel: () => settleDrag(true),
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      data-bottom-sheet=""
      className={cn("fixed inset-0 z-50 flex flex-col justify-end", className)}
      {...portalProps}
    >
      <div
        data-bottom-sheet-scrim
        aria-hidden="true"
        className="absolute inset-0 bg-black/40 dark:bg-black/60"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-bottom-sheet-panel
        style={{ maxHeight: "90dvh" }}
        className={cn(
          "bottom-sheet-panel relative z-10 flex w-full flex-col overflow-hidden rounded-t-2xl border-t border-border/80 bg-card shadow-lg shadow-black/10",
          "transition-transform duration-[220ms] ease-out pb-[var(--safe-bottom)]",
        )}
      >
        {/* Handle and header are one drag surface: the whole top of the sheet answers to a pull. */}
        <div
          data-bottom-sheet-drag
          className="shrink-0 touch-none"
          {...dragHandlers}
        >
          <div
            data-bottom-sheet-handle
            aria-hidden="true"
            className="flex cursor-grab justify-center pb-1 pt-2.5 active:cursor-grabbing"
          >
            <span className="h-1 w-10 rounded-full bg-border" />
          </div>

          <div
            data-bottom-sheet-header
            className="flex items-center justify-between gap-3 border-b border-border/60 px-4 pb-2.5"
          >
            <div className="min-w-0">
              <h2
                id={titleId}
                className={cn(
                  "truncate text-[13px] font-medium text-muted-foreground",
                  titleClassName,
                )}
              >
                {title}
              </h2>
              {subtitle && (
                <p className="truncate text-[13px] text-muted-foreground tabular-nums">
                  {subtitle}
                </p>
              )}
            </div>

            {(headerAction || showCloseButton) && (
              <div className="flex shrink-0 items-center gap-2">
                {headerAction}
                {showCloseButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    data-bottom-sheet-close
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    aria-label={closeLabel}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div
          ref={bodyRef}
          data-bottom-sheet-body
          className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-app", bodyClassName)}
          {...bodyDragHandlers}
        >
          {children}
        </div>

        {footer && (
          <div
            data-bottom-sheet-footer
            className="shrink-0 border-t border-border/80 bg-card p-3.5"
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
