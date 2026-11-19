"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import { Loader2, X } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/** How long the armed control waits before it gives up and returns to idle. */
const AUTO_REVERT_MS = 4000;
/** Width morph time. Never movement, only the control making room for its own confirm. */
const MORPH_CLASSES = "transition-[max-width,opacity] duration-[180ms] ease-out";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onStoreChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener?.("change", onStoreChange);
  return () => query.removeEventListener?.("change", onStoreChange);
}

function hasReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function usePrefersReducedMotion() {
  // Read live, the way AnimatedNumber does: the reader can flip the preference
  // while the app is open. The server has no preference, so assume motion.
  return useSyncExternalStore(subscribeToReducedMotion, hasReducedMotion, () => false);
}

const BASE_BUTTON =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40";

const TRIGGER_CLASSES = {
  /** A quiet icon in a row: muted until it is needed, then the removal tone. */
  icon: "h-9 w-9 rounded-md border border-transparent text-muted-foreground hover:border-danger/30 hover:bg-danger/10 hover:text-danger-text max-sm:min-h-11 max-sm:min-w-11",
  /** A labelled action: still quiet, still a button you can read. */
  text: "h-9 gap-1.5 rounded-md border border-border/70 bg-card px-3 text-[13px] font-medium text-danger-text hover:border-danger/30 hover:bg-danger/10 max-sm:min-h-11",
} as const;

interface InlineConfirmButtonProps {
  /** Accessible name of the idle control, e.g. "Eliminar pago". */
  ariaLabel: string;
  /** Tooltip of the idle control; defaults to `ariaLabel`. */
  title?: string;
  /** Copy of the armed confirm button. Spanish sentence case. */
  confirmLabel?: string;
  /** Sentence announced to assistive tech when the control arms. */
  announce?: string;
  /** What the idle control looks like: an icon (rows) or a text label. */
  variant?: "icon" | "text";
  /** The action the second click runs. Failures are the caller's to report. */
  onConfirm: () => void | Promise<void>;
  /** Idle content: an icon for `icon`, the label for `text`. */
  children: ReactNode;
  disabled?: boolean;
  /** Override the 4 s self-revert, mainly for tests and slow flows. */
  autoRevertMs?: number;
  className?: string;
}

/**
 * A destructive row action that confirms inside itself instead of opening a
 * dialog: the first activation swaps the control for a danger-tinted confirm
 * plus a cancel, the same control growing to fit them in place.
 *
 * It is meant for actions that are reversible or small — a draft line, a
 * removable editor row — never for a stored record that cannot come back. The
 * armed state gives up on its own after four seconds, on Escape, and when focus
 * leaves the control, so a stray click can never sit there waiting.
 *
 * Nesting: clicks never reach the row or card around it, so the control is safe
 * inside the clickable rows built with `activationProps`.
 */
export function InlineConfirmButton({
  ariaLabel,
  title,
  confirmLabel = "¿Eliminar?",
  announce = "Confirma para eliminar",
  variant = "icon",
  onConfirm,
  children,
  disabled = false,
  autoRevertMs = AUTO_REVERT_MS,
  className,
}: InlineConfirmButtonProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  // A cancel, an Escape and a self-revert all leave the trigger in charge; a
  // blur caused by the reader moving on must not drag the focus back.
  const restoreFocusRef = useRef(false);

  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const morph = reducedMotion ? "transition-none" : MORPH_CLASSES;

  const disarm = (restoreFocus = false) => {
    restoreFocusRef.current = restoreFocus;
    setArmed(false);
  };

  // Focus lands on the confirm, never on the trigger, so a reader or a keyboard
  // can decide with one key press that does not land on the destructive half.
  useEffect(() => {
    if (!armed) return;
    confirmRef.current?.focus();
    const timer = window.setTimeout(() => disarm(false), autoRevertMs);
    return () => window.clearTimeout(timer);
  }, [armed, autoRevertMs]);

  // The trigger is hidden and out of the tab order while the control is armed,
  // so it can only take the focus back after the re-render that un-arms it.
  useEffect(() => {
    if (armed || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [armed]);

  const arm = () => {
    if (disabled || pendingRef.current || armed) return;
    haptic("tap");
    setArmed(true);
  };

  const runConfirm = () => {
    if (disabled || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    // The confirm, not the arm, is the destructive press the phone feels.
    haptic("warning");

    const settle = () => {
      pendingRef.current = false;
      setPending(false);
      // The row may be gone by now; when it survived (a failure the caller
      // reported), the focus belongs back on the control that is still there.
      disarm(true);
    };

    try {
      const result = onConfirm();
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>).then(settle, settle);
        return;
      }
    } catch {
      // The caller owns the error message; this control only returns to idle.
      settle();
      return;
    }
    settle();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!armed) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    disarm(true);
  };

  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!armed) return;
    const next = event.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    disarm(false);
  };

  return (
    <div
      ref={rootRef}
      data-inline-confirm={variant}
      data-state={armed ? "armed" : "idle"}
      data-motion={reducedMotion ? "reduced" : "full"}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      // A row or card around this control reacts to its own clicks only.
      onClick={(event) => event.stopPropagation()}
      className={cn("relative inline-flex items-center", className)}
    >
      {/* Both halves stay mounted so the width can travel between them; the
          half that is not showing is out of the accessibility tree, out of the
          tab order and deaf to the pointer. It is not `inert`: making the
          focused element inert would hand the focus to the body mid-morph and
          blur the control closed. */}
      <div
        data-inline-confirm-idle=""
        className={cn(
          "flex min-w-0 items-center overflow-hidden",
          morph,
          armed
            ? "pointer-events-none max-w-0 opacity-0"
            : "max-w-[14rem] opacity-100",
        )}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          title={title ?? ariaLabel}
          disabled={disabled}
          tabIndex={armed ? -1 : undefined}
          aria-hidden={armed || undefined}
          onClick={arm}
          className={cn(BASE_BUTTON, TRIGGER_CLASSES[variant])}
        >
          {children}
        </button>
      </div>

      <div
        data-inline-confirm-armed=""
        className={cn(
          "flex min-w-0 items-center overflow-hidden rounded-md border border-danger/40 bg-danger/15",
          morph,
          armed
            ? "max-w-[16rem] opacity-100"
            : "pointer-events-none invisible max-w-0 opacity-0",
        )}
      >
        <button
          ref={confirmRef}
          type="button"
          disabled={disabled || pending}
          aria-busy={pending || undefined}
          tabIndex={armed ? undefined : -1}
          aria-hidden={!armed || undefined}
          onClick={runConfirm}
          className={cn(
            BASE_BUTTON,
            "h-[34px] gap-1.5 rounded-none bg-transparent px-2.5 text-[13px] font-semibold text-danger-text hover:bg-danger/20",
          )}
        >
          {pending && (
            <Loader2
              className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {confirmLabel}
        </button>
        <button
          type="button"
          aria-label="Cancelar"
          title="Cancelar"
          disabled={pending}
          tabIndex={armed ? undefined : -1}
          aria-hidden={!armed || undefined}
          onClick={() => disarm(true)}
          className={cn(
            BASE_BUTTON,
            "h-[34px] w-9 rounded-none border-l border-danger/20 bg-transparent text-danger-text hover:bg-danger/20",
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {armed ? announce : ""}
      </span>
    </div>
  );
}
