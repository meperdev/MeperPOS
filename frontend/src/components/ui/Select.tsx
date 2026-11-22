"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
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

interface PopoverPlacement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

/** All vertical scroll ancestors (e.g., nested list inside a modal body). */
function findScrollParents(node: HTMLElement | null): HTMLElement[] {
  const scrollers: HTMLElement[] = [];
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const { overflowY } = window.getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") scrollers.push(el);
  }
  return scrollers;
}

const MENU_ROW_HEIGHT = 36;
const MENU_MAX_HEIGHT = 240;
const POPOVER_EDGE_GAP = 8;
const POPOVER_OFFSET = 6;
const MIN_MENU_HEIGHT = 88;

/**
 * Computes fixed viewport coordinates anchored to the trigger button so a
 * portaled desktop listbox never gets clipped by `overflow-hidden` or nested
 * scroll containers inside modals and cards.
 */
function computePopoverPlacement(
  trigger: HTMLElement,
  optionCount: number,
): PopoverPlacement {
  const rect = trigger.getBoundingClientRect();
  const viewportHeight = window.innerHeight || 0;
  const viewportWidth = window.innerWidth || 0;
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - POPOVER_EDGE_GAP - POPOVER_OFFSET);
  const spaceAbove = Math.max(0, rect.top - POPOVER_EDGE_GAP - POPOVER_OFFSET);
  const desiredHeight = Math.min(MENU_MAX_HEIGHT, optionCount * MENU_ROW_HEIGHT + 12);
  const placement: "top" | "bottom" =
    spaceBelow < desiredHeight && spaceAbove > spaceBelow ? "top" : "bottom";
  const availableSpace = placement === "top" ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(MIN_MENU_HEIGHT, Math.min(MENU_MAX_HEIGHT, availableSpace));
  const maxLeft = Math.max(POPOVER_EDGE_GAP, viewportWidth - rect.width - POPOVER_EDGE_GAP);
  const left =
    viewportWidth > 0 && rect.width > 0
      ? Math.min(Math.max(rect.left, POPOVER_EDGE_GAP), maxLeft)
      : rect.left;

  return {
    left,
    width: rect.width,
    top: placement === "bottom" ? rect.bottom + POPOVER_OFFSET : undefined,
    bottom: placement === "top" ? viewportHeight - rect.top + POPOVER_OFFSET : undefined,
    maxHeight,
    placement,
  };
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
  const [popover, setPopover] = useState<PopoverPlacement | null>(null);
  // Below `sm` the list is a sheet in a body portal instead of a dropdown.
  const belowSm = useBelowSmViewport();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const listboxId = useId();
  const errorId = useId();

  const selectedOption = options.find((opt) => opt.value === value);
  const sheet = isOpen && belowSm;

  useEffect(() => {
    // The sheet carries its own overlay; a mousedown inside it is not "outside".
    if (!isOpen || belowSm) return;
    const raf = window.requestAnimationFrame(() => {
      if (triggerRef.current) {
        setPopover(computePopoverPlacement(triggerRef.current, options.length));
      }
    });

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        setIsOpen(false);
        setPopover(null);
      }
    };

    const handleReposition = (event: Event) => {
      if (
        event.type === "scroll" &&
        event.target instanceof Node &&
        listRef.current?.contains(event.target)
      ) {
        return;
      }
      const trigger = triggerRef.current;
      if (!trigger) return;
      const triggerRect = trigger.getBoundingClientRect();
      if (
        window.innerHeight > 0 &&
        triggerRect.height > 0 &&
        (triggerRect.bottom <= 0 || triggerRect.top >= window.innerHeight)
      ) {
        setIsOpen(false);
        setPopover(null);
        return;
      }
      const scrollers = findScrollParents(containerRef.current);
      for (const scroller of scrollers) {
        const scrollerRect = scroller.getBoundingClientRect();
        if (
          scrollerRect.height > 0 &&
          (triggerRect.bottom <= scrollerRect.top ||
            triggerRect.top >= scrollerRect.bottom)
        ) {
          setIsOpen(false);
          setPopover(null);
          return;
        }
      }
      setPopover(computePopoverPlacement(trigger, options.length));
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen, belowSm, options.length]);

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
    if (isOpen) {
      setIsOpen(false);
      setPopover(null);
      return;
    }
    if (!belowSm && triggerRef.current) {
      setPopover(computePopoverPlacement(triggerRef.current, options.length));
    } else {
      setPopover(null);
    }
    setIsOpen(true);
  };

  const closeToTrigger = () => {
    setIsOpen(false);
    setPopover(null);
    triggerRef.current?.focus();
  };

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    closeToTrigger();
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setPopover(null);
    } else if (event.key === "Tab") {
      setIsOpen(false);
      setPopover(null);
    }
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
      setPopover(null);
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

  // The list is the focused surface in both presentations, so it owns Escape
  // and Tab before the Modal behind the sheet sees them: Escape closes the
  // options, never the dialog that opened them.
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
          "flex w-full items-center justify-between px-3 py-2 min-h-11 sm:min-h-9 rounded-md text-sm font-medium cursor-pointer transition-colors duration-150",
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
          className="mb-1.5 block text-[13px] font-medium text-muted-foreground"
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
        onKeyDown={handleTriggerKeyDown}
        data-select-trigger
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "w-full h-10 sm:h-9 rounded-lg border bg-card px-3.5 py-2 text-sm font-medium text-foreground",
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
      <BottomSheet
        isOpen={sheet}
        onClose={closeToTrigger}
        title={label ?? placeholder}
        showCloseButton={false}
        className="z-[60]"
        returnFocusTo={triggerRef}
        portalProps={{ "data-select-sheet": "" }}
        bodyClassName="p-1.5"
      >
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label ?? placeholder}
          onKeyDown={handleListKeyDown}
          className="flex flex-col gap-1"
        >
          {options.map((option) => optionRow(option))}
        </div>
      </BottomSheet>

      {isOpen &&
        !belowSm &&
        popover &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            data-select-popover=""
            data-placement={popover.placement}
            aria-label={label ?? placeholder}
            onKeyDown={handleListKeyDown}
            style={{
              position: "fixed",
              left: popover.left,
              width: popover.width,
              top: popover.top,
              bottom: popover.bottom,
              maxHeight: popover.maxHeight,
            }}
            className="scrollbar-app z-[70] flex flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lg shadow-black/10"
          >
            {options.map((option) => optionRow(option))}
          </div>,
          document.body,
        )}

      {error && (
        <span id={errorId} className="mt-1.5 block text-[13px] font-medium text-danger-text">
          {error}
        </span>
      )}
    </div>
  );
}
