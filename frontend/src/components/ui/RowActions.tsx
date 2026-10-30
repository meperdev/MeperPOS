"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type RowActionItem =
  | {
      kind?: "action";
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
      destructive?: boolean;
    }
  | {
      kind: "file";
      label: string;
      icon?: ReactNode;
      accept: string;
      onFile: (file: File) => void;
      disabled?: boolean;
    };

const MENU_WIDTH = 192;

/**
 * Overflow menu for row/card actions. Rendered in a portal so a card that
 * clips its content cannot cut the menu off; the arrow keys walk the items,
 * Escape and outside clicks close it, and focus returns to the trigger.
 */
export function RowActions({
  items,
  label = "Más acciones",
  className,
  triggerClassName,
  menuOffset = 8,
}: {
  items: RowActionItem[];
  label?: string;
  className?: string;
  triggerClassName?: string;
  /** Extra distance between the menu and the trigger, per side. */
  menuOffset?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const itemClass = (disabled?: boolean, destructive?: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      disabled
        ? "cursor-not-allowed text-muted-foreground/50"
        : destructive
          ? "text-rose-700 hover:bg-rose-500/10 dark:text-rose-400"
          : "text-foreground hover:bg-muted",
    );

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOpen(true);
    const EDGE = 8;
    const alignRight = rect.right - MENU_WIDTH;
    const spaceBelow = window.innerHeight - rect.bottom;

    // A rail (collapsed sidebar) leaves no room to align right edges: the menu
    // opens beside the trigger instead, top aligned, so it clears the stack of
    // controls above it.
    if (alignRight < EDGE) {
      setPosition({
        position: "fixed",
        left: Math.min(rect.right + EDGE, window.innerWidth - MENU_WIDTH - EDGE),
        top: rect.top,
        width: MENU_WIDTH,
      });
      return;
    }

    setPosition({
      position: "fixed",
      left: Math.min(alignRight, window.innerWidth - MENU_WIDTH - EDGE),
      width: MENU_WIDTH,
      ...(spaceBelow < 200
        ? { bottom: window.innerHeight - rect.top + menuOffset }
        : { top: rect.bottom + menuOffset }),
    });
  };

  useEffect(() => {
    if (!open) return;

    const focusFirst = window.requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (menu) {
        const rect = menu.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 8) {
          setPosition((current) =>
            current
              ? {
                  ...current,
                  top: Math.max(8, window.innerHeight - rect.height - 8),
                  bottom: undefined,
                }
              : current,
          );
        }
      }
      menu
        ?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
        ?.focus();
    });

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        event.stopPropagation();
      }
      setOpen(false);
      triggerRef.current?.focus();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close(event);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const entries = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])',
        ) ?? [],
      );
      if (entries.length === 0) return;
      event.preventDefault();
      const index = entries.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(index + step + entries.length) % entries.length]?.focus();
    };

    const handleScroll = () => setOpen(false);

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={toggle}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/60 hover:text-foreground",
          triggerClassName,
        )}
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            style={position}
            className="z-50 rounded-lg border border-border/70 bg-card p-1 shadow-lg"
          >
            {items.map((item) => {
              const disabled = item.disabled;
              if (item.kind === "file") {
                return (
                  <FileMenuItem
                    key={item.label}
                    item={item}
                    disabled={disabled}
                    className={itemClass(disabled)}
                    onDone={() => {
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                  />
                );
              }
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  aria-disabled={disabled}
                  disabled={disabled}
                  title={item.label}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={itemClass(disabled, item.destructive)}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

function FileMenuItem({
  item,
  disabled,
  className,
  onDone,
}: {
  item: Extract<RowActionItem, { kind: "file" }>;
  disabled?: boolean;
  className: string;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        role="menuitem"
        aria-disabled={disabled}
        disabled={disabled}
        title={item.label}
        className={className}
        onClick={() => inputRef.current?.click()}
      >
        {item.icon}
        {item.label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={item.accept}
        aria-label={item.label}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) item.onFile(file);
          event.target.value = "";
          onDone();
        }}
      />
    </>
  );
}
