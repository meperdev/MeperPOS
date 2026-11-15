"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterGroup, FilterOptionButton } from "./FilterBar";

export type ViewMode = "grid" | "table";

/**
 * The one list/card switch shared by every collection page. Order, icons,
 * labels, hit area and placement are fixed here so no page can drift.
 */
export function ViewModeToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Cambiar vista"
      className={cn("ml-auto hidden sm:inline-flex", className)}
    >
      {/* Same borderless track as every FilterGroup: 2px padding + h-8 segments = 36px, the field height (h-9). */}
      <FilterGroup innerClassName="overflow-visible max-w-none">
        <FilterOptionButton
          active={value === "grid"}
          onClick={() => onChange("grid")}
          className="h-8 w-8 px-0"
          aria-label="Vista en tarjeta"
          title="Vista en tarjeta"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </FilterOptionButton>
        <FilterOptionButton
          active={value === "table"}
          onClick={() => onChange("table")}
          className="h-8 w-8 px-0"
          aria-label="Vista en lista"
          title="Vista en lista"
        >
          <List className="w-3.5 h-3.5" />
        </FilterOptionButton>
      </FilterGroup>
    </div>
  );
}
