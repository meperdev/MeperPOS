"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ToastStack } from "@/components/ui/ToastStack";
import type { ToastAction, ToastInput, ToastOptions, ToastType } from "@/components/ui/Toast";

export type { ToastAction, ToastOptions, ToastType } from "@/components/ui/Toast";

type ToastItem = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  action?: ToastAction;
  duration: number;
  leaving: boolean;
};

type TimerEntry = {
  timeout: number;
  startedAt: number;
  remaining: number;
  paused: boolean;
};

type ToastContextValue = {
  showToast: (type: ToastType, message: string, input?: ToastInput) => void;
  success: (message: string, input?: ToastInput) => void;
  error: (message: string, input?: ToastInput) => void;
  warning: (message: string, input?: ToastInput) => void;
  info: (message: string, input?: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const EXIT_MS = 160;

/**
 * A failure deserves more reading time than a confirmation. An error is the
 * only level that keeps the reader on the card, so it outlives the rest.
 */
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 4000,
  error: 6000,
};

/** A toast offering a recovery must stay long enough to be clicked. */
const ACTION_MIN_DURATION = 8000;

/** Never let notifications pile up into a wall: the oldest one bows out. */
const MAX_VISIBLE = 3;

function normalize(input: ToastInput | undefined, type: ToastType) {
  const options: ToastOptions = typeof input === "number" ? { duration: input } : (input ?? {});
  const base = options.duration ?? DEFAULT_DURATION[type];
  return {
    description: options.description,
    action: options.action,
    duration: options.action ? Math.max(base, ACTION_MIN_DURATION) : base,
  };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastsRef = useRef<ToastItem[]>([]);
  const timersRef = useRef(new Map<string, TimerEntry>());

  const commit = useCallback((next: ToastItem[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const clearTimer = useCallback((id: string) => {
    const entry = timersRef.current.get(id);
    if (entry) {
      window.clearTimeout(entry.timeout);
      timersRef.current.delete(id);
    }
  }, []);

  const removeNow = useCallback(
    (id: string) => {
      clearTimer(id);
      commit(toastsRef.current.filter((toast) => toast.id !== id));
    },
    [clearTimer, commit],
  );

  const dismiss = useCallback(
    (id: string) => {
      const toast = toastsRef.current.find((item) => item.id === id);
      if (!toast || toast.leaving) return;
      clearTimer(id);
      commit(
        toastsRef.current.map((item) =>
          item.id === id ? { ...item, leaving: true } : item,
        ),
      );
      window.setTimeout(() => removeNow(id), EXIT_MS);
    },
    [clearTimer, commit, removeNow],
  );

  const schedule = useCallback(
    (id: string, remaining: number) => {
      const timeout = window.setTimeout(() => dismiss(id), remaining);
      timersRef.current.set(id, {
        timeout,
        startedAt: Date.now(),
        remaining,
        paused: false,
      });
    },
    [dismiss],
  );

  const pause = useCallback((id: string) => {
    const entry = timersRef.current.get(id);
    if (!entry || entry.paused) return;
    window.clearTimeout(entry.timeout);
    entry.remaining = Math.max(
      0,
      entry.remaining - (Date.now() - entry.startedAt),
    );
    entry.paused = true;
    timersRef.current.set(id, entry);
  }, []);

  const resume = useCallback(
    (id: string) => {
      const entry = timersRef.current.get(id);
      if (!entry || !entry.paused) return;
      const toast = toastsRef.current.find((item) => item.id === id);
      if (!toast || toast.leaving) return;
      schedule(id, entry.remaining);
    },
    [schedule],
  );

  /** Hovering the stack stops every countdown in it, not only the card under the pointer. */
  const pauseAll = useCallback(() => {
    toastsRef.current.forEach((toast) => pause(toast.id));
  }, [pause]);

  const resumeAll = useCallback(() => {
    toastsRef.current.forEach((toast) => resume(toast.id));
  }, [resume]);

  const showToast = useCallback(
    (type: ToastType, message: string, input?: ToastInput) => {
      const { description, action, duration } = normalize(input, type);

      const duplicate = toastsRef.current.find(
        (item) =>
          !item.leaving &&
          item.type === type &&
          item.title === message &&
          item.description === description,
      );

      // Repeating the same message refreshes it instead of stacking a copy.
      if (duplicate) {
        clearTimer(duplicate.id);
        commit(
          toastsRef.current.map((item) =>
            item.id === duplicate.id
              ? { ...item, duration, description, action }
              : item,
          ),
        );
        schedule(duplicate.id, duration);
        return;
      }

      const toast: ToastItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        title: message,
        description,
        action,
        duration,
        leaving: false,
      };
      const next = [...toastsRef.current, toast];
      commit(next);
      schedule(toast.id, duration);

      const live = next.filter((item) => !item.leaving);
      if (live.length > MAX_VISIBLE) {
        dismiss(live[0].id);
        // During a burst, keep at most one card animating out so the stack can
        // never grow into a wall while exits are still running.
        const leaving = toastsRef.current.filter((item) => item.leaving);
        if (leaving.length > 1) {
          removeNow(leaving[0].id);
        }
      }
    },
    [clearTimer, commit, dismiss, removeNow, schedule],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((entry) => window.clearTimeout(entry.timeout));
      timers.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      showToast,
      success: (message: string, input?: ToastInput) =>
        showToast("success", message, input),
      error: (message: string, input?: ToastInput) => showToast("error", message, input),
      warning: (message: string, input?: ToastInput) =>
        showToast("warning", message, input),
      info: (message: string, input?: ToastInput) => showToast("info", message, input),
    }),
    [showToast],
  );

  // Newest first: the freshest card is the one in front of the stack.
  const stackToasts = useMemo(
    () =>
      toasts
        .map((toast) => ({
          id: toast.id,
          type: toast.type,
          title: toast.title,
          description: toast.description,
          action: toast.action,
          leaving: toast.leaving,
        }))
        .reverse(),
    [toasts],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack
        toasts={stackToasts}
        onDismiss={dismiss}
        onPauseAll={pauseAll}
        onResumeAll={resumeAll}
      />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
