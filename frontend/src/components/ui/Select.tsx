"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBelowSmViewport } from "@/hooks/useVisualViewport";

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeClass?: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
  name?: string;
  disabled?: boolean;
  className?: string;
}

/** Nearest ancestor that scrolls vertically (a modal body, a panel), or null when the page scrolls. */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const { overflowY } = window.getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

const MENU_ROW_HEIGHT = 36;
// Touch rows are 44px tall (min-h-11), so the open-direction estimate has to match or it
// decides on a height the menu will not have.
const MENU_ROW_HEIGHT_TOUCH = 44;
const MENU_MAX_HEIGHT = 240;
const TOUCH_VIEWPORT_QUERY = "(min-width: 640px)";

/**
 * Row height the open estimate must assume. Below the `sm` breakpoint the rows keep the
 * 44px touch target; when the environment cannot answer, assume touch so the menu errs
 * towards opening upwards rather than being clipped.
 */
function estimateMenuRowHeight(): number {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return MENU_ROW_HEIGHT_TOUCH;
  }
  return window.matchMedia(TOUCH_VIEWPORT_QUERY).matches
    ? MENU_ROW_HEIGHT
    : MENU_ROW_HEIGHT_TOUCH;
}

export function Select({
  options,
  value,
  onChange,
  label,
  placeholder = "Seleccionar...",
  error,
  required = false,
  name,
  disabled = false,
  className = "",
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  // Below `sm` the list is a sheet in a body portal instead of a dropdown.
  const belowSm = useBelowSmViewport();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const listboxId = useId();
  const sheetTitleId = useId();
  const errorId = useId();

  const selectedOption = options.find((opt) => opt.value === value);
  const sheet = isOpen && belowSm;

  useEffect(() => {
    // The sheet carries its own overlay; a mousedown inside it is not "outside".
    if (!isOpen || belowSm) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, belowSm]);

  // Keyboard users land on the current choice when the list opens.
  useEffect(() => {
    if (!isOpen) return;
    const current =
      listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ??
      listRef.current?.querySelector<HTMLElement>('[role="option"]');
    current?.focus();
  }, [isOpen, belowSm]);

  const toggleOpen = () => {
    if (disabled) return;
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // Measure against the visible scroll area, not the window: inside a modal the menu is
      // clipped by the modal body, and opening downwards there only grows its scroll height.
      const scroller = findScrollParent(containerRef.current)?.getBoundingClientRect();
      const visibleTop = Math.max(0, scroller?.top ?? 0);
      const visibleBottom = Math.min(window.innerHeight, scroller?.bottom ?? window.innerHeight);
      const spaceBelow = visibleBottom - rect.bottom;
      const spaceAbove = rect.top - visibleTop;
      const menuHeight = Math.min(MENU_MAX_HEIGHT, options.length * estimateMenuRowHeight() + 12);
      // Open upwards only when the menu does not fit below and there is more room above.
      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
        setOpenUpwards(true);
      } else {
        setOpenUpwards(false);
      }
    }
    setIsOpen((prev) => !prev);
  };

  const closeToTrigger = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    closeToTrigger();
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeToTrigger();
      return;
    }
    if (event.key === "Tab") {
      // Focus the trigger before the option unmounts, so the default Tab
      // continues from here and the Modal focus trap is not left behind.
      triggerRef.current?.focus();
      setIsOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  // The sheet wraps the list, so it owns the keys before the Modal behind it
  // sees them: Escape must close the options, never the dialog that opened them.
  const handleSheetKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeToTrigger();
      return;
    }
    if (event.key === "Tab") {
      triggerRef.current?.focus();
      setIsOpen(false);
      return;
    }
    handleListKeyDown(event);
  };

  const optionRow = (option: SelectOption) => {
    const isSelected = option.value === value;
    return (
      <button
        key={option.value}
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={() => handleSelect(option.value)}
        className={cn(
          "flex w-full items-center justify-between px-3 py-2 min-h-11 sm:min-h-9 rounded-md text-xs font-medium cursor-pointer transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          isSelected
            ? "bg-primary-light text-primary-text font-bold"
            : "text-foreground hover:bg-muted/70"
        )}
      >
        <div className="flex items-center gap-2 truncate">
          {option.icon && (
            <span className="shrink-0">{option.icon}</span>
          )}
          <span className="truncate">{option.label}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {option.badge && (
            <span
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-md",
                option.badgeClass ||
                  "bg-muted text-muted-foreground"
              )}
            >
              {option.badge}
            </span>
          )}
          {isSelected && (
            <Check aria-hidden="true" className="w-3.5 h-3.5 text-primary-text stroke-[3]" />
          )}
        </div>
      </button>
    );
  };

  return (
    <div className={cn("relative w-full", className)} ref={containerRef}>
      {label && (
        <label
          htmlFor={triggerId}
          className="mb-1.5 block text-xs font-medium text-muted-foreground"
        >
          {label}
        </label>
      )}

      {/* Hidden native select keeps form submission and value semantics; AT and focus use the trigger. */}
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        aria-invalid={error ? "true" : undefined}
        className="sr-only"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} />
        ))}
      </select>

      {/* Trigger Button. aria-invalid belongs on the native field; the trigger points at the message. */}
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        data-select-trigger
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "w-full h-10 sm:h-9 rounded-lg border bg-card px-3.5 py-2 text-xs font-medium text-foreground",
          "flex items-center justify-between gap-2 shadow-2xs transition-colors duration-150",
          "focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/25",
          error
            ? "border-danger focus:border-danger focus:ring-danger/25"
            : isOpen
              ? "border-primary/60 ring-2 ring-primary/25"
              : "border-border/70 hover:border-border",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className="flex items-center gap-2 truncate">
          {selectedOption?.icon && (
            <span className="shrink-0">{selectedOption.icon}</span>
          )}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>

        <ChevronDown
          aria-hidden="true"
          className={cn(
            "w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200",
            isOpen && "rotate-180 text-primary-text"
          )}
        />
      </button>

      {/* Options: a bottom sheet below sm, the floating menu from sm up. */}
      {sheet &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex flex-col justify-end" data-select-sheet>
            <div
              data-select-sheet-overlay
              aria-hidden="true"
              className="absolute inset-0 bg-black/40 dark:bg-black/60"
              onClick={closeToTrigger}
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={sheetTitleId}
              onKeyDown={handleSheetKeyDown}
              className={cn(
                "relative flex w-full flex-col rounded-t-2xl border border-border border-x-0 border-b-0 bg-card pb-[var(--safe-bottom)]",
                "shadow-lg shadow-black/10 animate-sheet-up",
                "max-h-[min(calc(100dvh-var(--safe-top)-0.75rem),100%)]",
              )}
            >
              <div aria-hidden="true" className="flex shrink-0 justify-center pb-1 pt-2.5">
                <span className="h-1 w-10 rounded-full bg-border" />
              </div>

              <h2
                id={sheetTitleId}
                className="shrink-0 border-b border-border/60 px-4 pb-2.5 text-xs font-medium text-muted-foreground"
              >
                {label ?? placeholder}
              </h2>

              <div
                ref={listRef}
                id={listboxId}
                role="listbox"
                aria-label={label ?? placeholder}
                className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto scrollbar-app p-1.5"
              >
                {options.map((option) => optionRow(option))}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {isOpen && !belowSm && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label ?? placeholder}
          onKeyDown={handleListKeyDown}
          className={cn(
            "absolute left-0 right-0 z-50 flex flex-col gap-1 rounded-xl border border-border bg-card p-1.5",
            "shadow-lg shadow-black/10",
            "max-h-60 overflow-y-auto scrollbar-app",
            openUpwards ? "bottom-full mb-1.5" : "top-full mt-1.5"
          )}
        >
          {options.map((option) => optionRow(option))}
        </div>
      )}

      {error && (
        <span id={errorId} className="mt-1.5 block text-xs font-medium text-danger-text">
          {error}
        </span>
      )}
    </div>
  );
}
