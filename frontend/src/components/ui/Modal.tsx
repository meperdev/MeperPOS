"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
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
  children,
  footer,
  size = "md",
  scrollContent = true,
  className,
}: ModalProps) {
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "unset";
    return () => { document.body.style.overflow = "unset"; };
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
            <h2 className={cn("text-base font-bold text-foreground pr-2", scrollContent ? "truncate" : "min-w-0 [overflow-wrap:anywhere]")}>{title}</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg border border-border/60 bg-muted/40 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-xs shrink-0"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className={cn("p-4 sm:p-6", scrollContent ? "overflow-y-auto scrollbar-app flex-1" : "shrink-0")}>{children}</div>

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
