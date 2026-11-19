"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { shouldAutoFocusTextInput } from "@/lib/input-focus";

/**
 * Search input with the HIG behaviours: magnifier, native search semantics, a
 * clear affordance while there is text, and Escape to clear.
 */
export function SearchField({
  value,
  onChange,
  placeholder = "Buscar...",
  ariaLabel,
  autoFocus = false,
  className,
  inputClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn("relative w-full", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        // A search field that grabs focus on mount opens the phone keyboard
        // over the list it is meant to filter; `autoFocus` stays a desktop hint.
        autoFocus={autoFocus && shouldAutoFocusTextInput()}
        aria-label={ariaLabel ?? "Buscar"}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        className={cn(
          "h-10 sm:h-9 w-full rounded-lg border border-transparent bg-muted/40 pl-9 pr-9 text-base text-foreground transition-colors",
          "placeholder:text-muted-foreground/60 focus:border-primary/60 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/25 sm:text-sm",
          "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
          inputClassName,
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Limpiar búsqueda"
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
