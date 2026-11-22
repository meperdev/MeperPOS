"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  TOAST_DEPTH_OFFSET,
  ToastCard,
  type ToastAction,
  type ToastType,
} from "@/components/ui/Toast";

export type ToastStackItem = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  action?: ToastAction;
  leaving: boolean;
};

/** A wall of notifications stops being a notification. Three, then the oldest bows out. */
export const MAX_VISIBLE_TOASTS = 3;

type ToastStackProps = {
  /** Newest first: the first entry is the card in front. */
  toasts: ToastStackItem[];
  onDismiss: (id: string) => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
};

function ToastStackViewport({
  visible,
  onDismiss,
  onPauseAll,
  onResumeAll,
}: {
  visible: ToastStackItem[];
  onDismiss: (id: string) => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
}) {
  // Three separate reasons to be open. A touch tap pins the stack, so the
  // mouse events a tap emulates afterwards cannot close what it just opened.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);

  const expanded = hovered || focused || pinned;
  const expandedRef = useRef(false);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const resumeRef = useRef(onResumeAll);

  useEffect(() => {
    resumeRef.current = onResumeAll;
  }, [onResumeAll]);

  /** Expansion and the paused countdown are the same state, so they change together. */
  useEffect(() => {
    if (expandedRef.current === expanded) return;
    expandedRef.current = expanded;
    if (expanded) onPauseAll();
    else onResumeAll();
  }, [expanded, onPauseAll, onResumeAll]);

  useEffect(() => {
    return () => {
      if (expandedRef.current) {
        expandedRef.current = false;
        resumeRef.current();
      }
    };
  }, []);

  useEffect(() => {
    if (!pinned && !focused) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!stackRef.current?.contains(event.target as Node | null)) {
        setPinned(false);
        setFocused(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [pinned, focused]);

  // Removing a focused toast drops document.activeElement to document.body
  // without firing blur; watch stack DOM mutations and outside focus so `focused`
  // clears on the same microtask without a 16ms timer gap.
  useEffect(() => {
    if (!focused) return;
    const stack = stackRef.current;
    if (!stack) return;

    let active = true;
    const syncFocus = () => {
      if (active && !stack.contains(document.activeElement)) {
        setFocused(false);
      }
    };

    queueMicrotask(syncFocus);
    const observer = new MutationObserver(syncFocus);
    observer.observe(stack, { childList: true, subtree: true });

    const handleFocusIn = (event: FocusEvent) => {
      if (!stack.contains(event.target as Node | null)) {
        setFocused(false);
      }
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      active = false;
      observer.disconnect();
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [focused]);

  const front = visible[0];

  return (
    <div
      ref={stackRef}
      data-testid="toast-stack"
      data-expanded={expanded ? "true" : "false"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      // A touch screen has no hover, so a tap is what opens the stack.
      onClick={() => setPinned((previous) => !previous)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !front) return;
        event.stopPropagation();
        if (
          document.activeElement instanceof HTMLElement &&
          event.currentTarget.contains(document.activeElement)
        ) {
          document.activeElement.blur();
        }
        onDismiss(front.id);
      }}
      className={cn(
        "pointer-events-auto relative flex w-full max-w-[420px] flex-col",
        expanded ? "gap-2" : "gap-0",
      )}
    >
      {visible.map((toast, index) => (
        <ToastCard
          key={toast.id}
          type={toast.type}
          title={toast.title}
          description={toast.description}
          action={toast.action}
          depth={index}
          expanded={expanded}
          leaving={toast.leaving}
          onClose={() => onDismiss(toast.id)}
        />
      ))}
      {!expanded && visible.length > 1 && (
        <div
          aria-hidden="true"
          data-testid="toast-stack-hit-zone"
          className="absolute inset-x-0 top-full"
          style={{ height: `${(visible.length - 1) * TOAST_DEPTH_OFFSET}px` }}
        />
      )}
    </div>
  );
}

export function ToastStack({ toasts, onDismiss, onPauseAll, onResumeAll }: ToastStackProps) {
  const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);

  return (
    <div
      role="region"
      aria-label="Notificaciones"
      className={cn(
        "pointer-events-none fixed inset-x-0 z-[100] flex justify-center px-3",
        // Below `lg` the phone header owns the top edge; at `lg` the desktop
        // header does, and the stack must start under it, never on it.
        "top-[calc(var(--mobile-header)+var(--safe-top)+0.5rem)]",
        "lg:top-[calc(var(--app-header-height)+12px)]",
      )}
    >
      {visible.length > 0 && (
        <ToastStackViewport
          visible={visible}
          onDismiss={onDismiss}
          onPauseAll={onPauseAll}
          onResumeAll={onResumeAll}
        />
      )}
    </div>
  );
}
