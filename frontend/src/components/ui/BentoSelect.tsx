"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";

export interface BentoSelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeClass?: string;
}

interface BentoSelectProps {
  options: BentoSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
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
const MENU_MAX_HEIGHT = 240;

export function BentoSelect({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  label,
  className = "",
  disabled = false,
}: BentoSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

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
      const menuHeight = Math.min(MENU_MAX_HEIGHT, options.length * MENU_ROW_HEIGHT + 12);
      // Open upwards only when the menu does not fit below and there is more room above.
      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
        setOpenUpwards(true);
      } else {
        setOpenUpwards(false);
      }
    }
    setIsOpen((prev) => !prev);
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div className={cn("relative w-full", className)} ref={containerRef}>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        className={cn(
          "w-full h-[38px] rounded-lg border bg-card px-3.5 py-2 text-xs font-medium text-foreground",
          "flex items-center justify-between gap-2 shadow-2xs transition-colors duration-150",
          "focus:outline-none focus:ring-2 focus:ring-primary/15",
          isOpen
            ? "border-primary/60 ring-2 ring-primary/15"
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
          className={cn(
            "w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200",
            isOpen && "rotate-180 text-primary-text"
          )}
        />
      </button>

      {/* Floating Bento Popover Menu */}
      {isOpen && (
        <div
          className={cn(
            "absolute left-0 right-0 z-50 flex flex-col gap-1 rounded-xl border border-border/80 bg-card p-1.5",
            "shadow-xl shadow-black/10 backdrop-blur-md animate-fade-in-up",
            "max-h-60 overflow-y-auto scrollbar-app",
            openUpwards ? "bottom-full mb-1.5" : "top-full mt-1.5"
          )}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className={cn(
                  "flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium cursor-pointer transition-all duration-150",
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
                        "text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md",
                        option.badgeClass ||
                          "bg-muted text-muted-foreground"
                      )}
                    >
                      {option.badge}
                    </span>
                  )}
                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-primary-text stroke-[3]" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
