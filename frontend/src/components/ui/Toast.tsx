"use client";

import { Check, Info, TriangleAlert, X } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "warning" | "info";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  description?: string;
  duration?: number;
  action?: ToastAction;
};

/** `message` is the title; the rest is optional. A bare number is still a duration. */
export type ToastInput = number | ToastOptions;

const TONE: Record<ToastType, { tile: string; icon: React.ReactNode }> = {
  success: {
    tile: "bg-toast-success",
    icon: <Check className="h-4 w-4" strokeWidth={2.75} aria-hidden="true" />,
  },
  error: {
    tile: "bg-toast-danger",
    icon: <X className="h-4 w-4" strokeWidth={2.75} aria-hidden="true" />,
  },
  warning: {
    tile: "bg-toast-warning",
    icon: <TriangleAlert className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />,
  },
  info: {
    tile: "bg-toast-info",
    icon: <Info className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />,
  },
};

/** The second and third card sit further back and further down, never on top. */
const DEPTH_OFFSET = 8;
const DEPTH_SCALE = 0.05;
/**
 * Opacity alone would make the peeking edges vanish under the front card's
 * shadow; these keep each band readable as a card that is waiting its turn.
 */
const DEPTH_OPACITY = [1, 0.9, 0.78];

export type ToastCardProps = {
  type: ToastType;
  title: string;
  description?: string;
  action?: ToastAction;
  /** 0 is the front card; 1 and 2 peek behind it. */
  depth?: number;
  expanded?: boolean;
  leaving?: boolean;
  onClose: () => void;
};

export function ToastCard({
  type,
  title,
  description,
  action,
  depth = 0,
  expanded = false,
  leaving = false,
  onClose,
}: ToastCardProps) {
  const tone = TONE[type];
  const peeking = !expanded && depth > 0;

  return (
    <div
      data-testid="toast-card"
      data-depth={depth}
      role={type === "error" ? "alert" : "status"}
      aria-atomic="true"
      style={{
        zIndex: 10 - depth,
        ...(peeking
          ? {
              transform: `translateY(${depth * DEPTH_OFFSET}px) scale(${
                1 - depth * DEPTH_SCALE
              })`,
              opacity: DEPTH_OPACITY[Math.min(depth, DEPTH_OPACITY.length - 1)],
            }
          : null),
      }}
      className={cn(
        "group/toast w-full rounded-2xl border border-border bg-card p-3",
        // One elevation only: a border, and a soft offset shadow tight enough
        // that it never washes over the cards peeking behind this one.
        "shadow-[0_10px_28px_-18px_rgba(0,0,0,0.45)] dark:shadow-[0_10px_28px_-18px_rgba(0,0,0,0.75)]",
        "transition-[transform,opacity] duration-200 ease-out",
        peeking ? "pointer-events-none absolute inset-x-0 top-0 origin-top" : "relative",
        // Only the card that arrives in front earns an entrance. A peeking card
        // appearing behind must not replay that motion when the stack opens.
        leaving ? "animate-toast-out" : depth === 0 && "animate-toast-in",
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Cerrar notificación"
        className={cn(
          "absolute -left-2 -top-2 z-20 flex h-[22px] w-[22px] items-center justify-center rounded-full",
          "border border-border bg-card text-muted-foreground shadow-sm",
          "transition-opacity duration-150 hover:text-foreground",
          "opacity-0 group-hover/toast:opacity-100 group-focus-within/toast:opacity-100",
          // No hover on a touch screen, so there it is always on.
          "[@media(hover:none)]:opacity-100",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        )}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>

      <div className="flex items-start gap-3">
        <span
          data-testid="toast-icon-tile"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white",
            tone.tile,
          )}
        >
          {tone.icon}
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          <p className="break-words text-sm font-semibold leading-5 text-foreground">{title}</p>
          {description && (
            <p className="mt-0.5 break-words text-[13px] leading-snug text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        {action && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              action.onClick();
              onClose();
            }}
            className={cn(buttonClassName({ variant: "secondary", size: "sm" }), "shrink-0")}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
