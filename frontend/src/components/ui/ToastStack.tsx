"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ToastCard, type ToastAction, type ToastType } from "@/components/ui/Toast";

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

export function ToastStack({ toasts, onDismiss, onPauseAll, onResumeAll }: ToastStackProps) {
  // Three separate reasons to be open. A touch tap pins the stack, so the
  // mouse events a tap emulates afterwards cannot close what it just opened.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);

  const expanded = hovered || focused || pinned;
  const expandedRef = useRef(false);

  /** Expansion and the paused countdown are the same state, so they change together. */
  useEffect(() => {
    if (expandedRef.current === expanded) return;
    expandedRef.current = expanded;
    if (expanded) onPauseAll();
    else onResumeAll();
  }, [expanded, onPauseAll, onResumeAll]);

  const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);
  const front = visible[0];

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
      <div
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
      </div>
    </div>
  );
}
