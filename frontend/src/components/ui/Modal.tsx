"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

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
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

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
    // the form, not on the way out of it.
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
      return inBody[0] ?? focusables()[0] ?? null;
    };

    const focusInitial = () => {
      (initialTarget() ?? panel)?.focus();
    };
    // Focus immediately for deterministic behaviour, then again after layout so
    // a field that mounts late still receives it.
    focusInitial();
    const frame = window.requestAnimationFrame(focusInitial);

    // Programmatic focus can escape a dialog; bring it back instead of leaving
    // the keyboard user on the page behind it.
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && panel && !panel.contains(event.target)) {
        (initialTarget() ?? panel)?.focus();
      }
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 md:p-8">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
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
        className={cn(
          "relative w-full rounded-xl sm:rounded-2xl border border-border/80",
          "bg-card shadow-2xl shadow-black/20",
          "animate-fade-in-up flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] md:max-h-[calc(100dvh-4rem)]",
          sizes[size],
          className,
        )}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-6 sm:py-4 shrink-0">
            <h2 id={titleId} className={cn("text-base font-bold text-foreground pr-2", scrollContent ? "truncate" : "min-w-0 [overflow-wrap:anywhere]")}>{title}</h2>
            <button
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-9 sm:w-9"
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
          <div className="border-t border-border/60 px-4 py-3 sm:px-6 sm:py-3.5 bg-muted/10 shrink-0 rounded-b-xl sm:rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
