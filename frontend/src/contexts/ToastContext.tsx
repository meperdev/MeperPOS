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
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  /** Bumped when an identical message is re-shown, so its progress bar restarts. */
  version: number;
  leaving: boolean;
};

type TimerEntry = {
  timeout: number;
  startedAt: number;
  remaining: number;
};

type ToastContextValue = {
  showToast: (type: ToastType, message: string, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** Never let notifications pile up into a wall: the oldest one bows out. */
const MAX_VISIBLE = 3;
const EXIT_MS = 160;
const DEFAULT_DURATION = 3500;

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
      });
    },
    [dismiss],
  );

  const pause = useCallback((id: string) => {
    const entry = timersRef.current.get(id);
    if (!entry) return;
    window.clearTimeout(entry.timeout);
    entry.remaining = Math.max(
      0,
      entry.remaining - (Date.now() - entry.startedAt),
    );
    timersRef.current.set(id, entry);
  }, []);

  const resume = useCallback(
    (id: string) => {
      const entry = timersRef.current.get(id);
      if (!entry) return;
      const toast = toastsRef.current.find((item) => item.id === id);
      if (!toast || toast.leaving) return;
      schedule(id, entry.remaining);
    },
    [schedule],
  );

  const showToast = useCallback(
    (type: ToastType, message: string, duration = DEFAULT_DURATION) => {
      const duplicate = toastsRef.current.find(
        (item) => !item.leaving && item.type === type && item.message === message,
      );

      // Repeating the same message refreshes it instead of stacking a copy.
      if (duplicate) {
        clearTimer(duplicate.id);
        commit(
          toastsRef.current.map((item) =>
            item.id === duplicate.id
              ? { ...item, duration, version: item.version + 1 }
              : item,
          ),
        );
        schedule(duplicate.id, duration);
        return;
      }

      const toast: ToastItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        message,
        duration,
        version: 1,
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
      success: (message: string, duration?: number) =>
        showToast("success", message, duration),
      error: (message: string, duration?: number) =>
        showToast("error", message, duration),
      info: (message: string, duration?: number) =>
        showToast("info", message, duration),
    }),
    [showToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-[100] flex flex-col items-center gap-2 px-4 lg:top-4">
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            onClose={dismiss}
            onPause={pause}
            onResume={resume}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONE = {
  success: {
    icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    barClass: "bg-emerald-500/70",
  },
  error: {
    icon: <AlertCircle className="h-4 w-4" aria-hidden="true" />,
    iconClass: "text-rose-600 dark:text-rose-400",
    barClass: "bg-rose-500/70",
  },
  info: {
    icon: <Info className="h-4 w-4" aria-hidden="true" />,
    iconClass: "text-muted-foreground",
    barClass: "bg-foreground/35",
  },
} as const;

function ToastCard({
  toast,
  onClose,
  onPause,
  onResume,
}: {
  toast: ToastItem;
  onClose: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const tone = TONE[toast.type];

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => onPause(toast.id)}
      onMouseLeave={() => onResume(toast.id)}
      onFocus={() => onPause(toast.id)}
      onBlur={() => onResume(toast.id)}
      className={cn(
        "group pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-lg border border-border/70 bg-card shadow-lg",
        "pl-3 pr-2.5 py-2.5",
        toast.leaving ? "animate-toast-out" : "animate-toast-in",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 shrink-0", tone.iconClass)}>{tone.icon}</span>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-foreground">
          {toast.message}
        </p>
        <button
          type="button"
          onClick={() => onClose(toast.id)}
          aria-label="Cerrar notificación"
          className="-mr-0.5 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <span
        key={toast.version}
        aria-hidden="true"
        style={{ animationDuration: `${toast.duration}ms` }}
        className={cn(
          "absolute inset-x-0 bottom-0 h-px origin-left animate-toast-progress group-hover:[animation-play-state:paused]",
          tone.barClass,
        )}
      />
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
