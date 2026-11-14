import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
import { SearchField } from "@/components/ui/SearchField";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filterControls?: ReactNode;
  children?: ReactNode;
  preContent?: ReactNode;
  postContent?: ReactNode;
  className?: string;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  filterControls,
  children,
  preContent,
  postContent,
  className,
}: FilterBarProps) {
  const controls = filterControls ?? children;
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card p-2 shadow-2xs overflow-visible",
        className,
      )}
    >
      {preContent}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        {/* Search */}
        <SearchField
          value={searchValue}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          className="w-full sm:min-w-0 sm:flex-1"
        />
        {controls && (
          <div className="flex items-center gap-1.5 px-0.5 sm:px-1 flex-wrap w-full sm:w-auto">
            {controls}
          </div>
        )}
      </div>
      {postContent}
    </div>
  );
}

/**
 * Segmented filter group container for period or status toggles inside FilterBar.
 * Supports both Light and Dark themes.
 */
export function FilterGroup({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-1.5 flex-wrap max-w-full", className)}>
      {label && (
        <span className="text-xs font-medium text-muted-foreground mr-0.5">
          {label}
        </span>
      )}
      <div
        role="group"
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
          );
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          if (index === -1) return;
          event.preventDefault();
          const step = event.key === "ArrowRight" ? 1 : -1;
          items[(index + step + items.length) % items.length]?.focus();
        }}
        className="inline-flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-0.5 max-w-full overflow-x-auto"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Option button inside a FilterGroup.
 */
export function FilterOptionButton({
  active = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "h-7 px-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
        active
          ? "bg-card text-foreground shadow-2xs border border-border/60"
          : "border border-transparent text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Standardized clear/reset button for active filters inside FilterBar.
 */
export function FilterClearButton({
  label = "Limpiar",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted border border-border/70 bg-muted/40 transition-colors",
        className,
      )}
      {...props}
    >
      <X className="w-3 h-3 shrink-0" />
      {label}
    </button>
  );
}
