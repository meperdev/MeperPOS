"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const { overflowY } = window.getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

const MENU_ROW_HEIGHT = 36;
const MENU_MAX_HEIGHT = 240;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className = "", value, onChange, disabled, ...props }, ref) => {
    const id = useId();
    const selectRef = useRef<HTMLSelectElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [openUpwards, setOpenUpwards] = useState(false);

    const selectedOption =
      options.find((opt) => opt.value === String(value ?? "")) ?? options[0];

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
        const scroller = findScrollParent(containerRef.current)?.getBoundingClientRect();
        const visibleTop = Math.max(0, scroller?.top ?? 0);
        const visibleBottom = Math.min(
          window.innerHeight,
          scroller?.bottom ?? window.innerHeight,
        );
        const spaceBelow = visibleBottom - rect.bottom;
        const spaceAbove = rect.top - visibleTop;
        const menuHeight = Math.min(
          MENU_MAX_HEIGHT,
          options.length * MENU_ROW_HEIGHT + 12,
        );
        setOpenUpwards(spaceBelow < menuHeight && spaceAbove > spaceBelow);
      }
      setIsOpen((prev) => !prev);
    };

    const handleSelectOption = (nextValue: string) => {
      if (selectRef.current) {
        selectRef.current.value = nextValue;
      }
      if (onChange) {
        const syntheticEvent = {
          target: { value: nextValue },
          currentTarget: { value: nextValue },
        } as React.ChangeEvent<HTMLSelectElement>;
        onChange(syntheticEvent);
      }
      setIsOpen(false);
    };

    return (
      <div className="relative w-full" ref={containerRef}>
        {label && (
          <label
            htmlFor={id}
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            {label}
          </label>
        )}

        {/* Hidden native select preserves label association and form/testing semantics */}
        <select
          ref={(node) => {
            selectRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          tabIndex={-1}
          className="sr-only"
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} />
          ))}
        </select>

        {/* Custom Trigger matching BentoSelect */}
        <button
          type="button"
          disabled={disabled}
          onClick={toggleOpen}
          className={cn(
            "w-full h-[38px] rounded-lg border bg-card px-3.5 py-2 text-xs font-medium text-foreground",
            "flex items-center justify-between gap-2 shadow-2xs transition-colors duration-150",
            "focus:outline-none focus:ring-2 focus:ring-primary/15",
            error
              ? "border-red-500/70 focus:ring-red-500/15"
              : isOpen
                ? "border-primary/60 ring-2 ring-primary/15"
                : "border-border/70 hover:border-border",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          <span className="truncate">{selectedOption?.label ?? ""}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-180 text-primary-text",
            )}
          />
        </button>

        {isOpen && (
          <div
            className={cn(
              "absolute z-50 w-full rounded-xl border border-border/80 bg-card shadow-lg p-1 overflow-hidden",
              openUpwards ? "bottom-full mb-1.5" : "top-full mt-1.5",
            )}
          >
            <div className="max-h-60 overflow-y-auto scrollbar-none space-y-0.5">
              {options.map((option) => {
                const isSelected = option.value === String(value ?? selectedOption?.value ?? "");
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelectOption(option.value)}
                    className={cn(
                      "w-full px-3 py-2 text-xs text-left rounded-lg transition-colors flex items-center justify-between gap-2",
                      isSelected
                        ? "bg-primary-light text-primary-text font-bold"
                        : "text-foreground hover:bg-muted font-medium",
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary-text" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <span className="mt-1.5 block text-xs font-medium text-red-500">
            {error}
          </span>
        )}
      </div>
    );
  },
);

Select.displayName = "Select";
