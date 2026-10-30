"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const focusable = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function EmployeeDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = panel.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const elements = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusable));
    (elements()[0] ?? dialog).focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === "Tab") {
        const items = elements();
        const first = items[0]; const last = items[items.length - 1];
        if (!first || !last) { event.preventDefault(); dialog?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }
    function onFocus(event: FocusEvent) {
      if (event.target instanceof Node && !dialog?.contains(event.target)) (elements()[0] ?? dialog)?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocus);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="relative w-full max-w-2xl rounded-2xl border border-border/80 bg-card shadow-2xl flex flex-col max-h-[calc(100dvh-1rem)]">
      <div className="border-b border-border/60 px-4 py-3 sm:px-6 sm:py-4 pr-14"><h2 id={titleId} className="text-base font-bold text-foreground">{title}</h2></div>
      <div className="p-4 sm:p-6 overflow-y-auto scrollbar-app">{children}</div>
      <button type="button" aria-label="Cerrar" onClick={onClose} className="absolute right-4 top-3 w-8 h-8 rounded-xl border border-border/60 bg-muted/40 flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
    </div>
  </div>;
}
