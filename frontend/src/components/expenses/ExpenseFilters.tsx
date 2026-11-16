"use client";

import { FilterClearButton } from "@/components/ui/FilterBar";
import { Input } from "@/components/ui/Input";
import { SearchField } from "@/components/ui/SearchField";
import { Select } from "@/components/ui/Select";
import { ViewModeToggle, type ViewMode } from "@/components/ui/ViewModeToggle";
import type { ExpenseStatus } from "@/types";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  month: string;
  onMonthChange: (value: string) => void;
  labelId: string;
  onLabelChange: (value: string) => void;
  labels: Array<{ id: string; name: string }>;
  supplierId: string;
  onSupplierChange: (value: string) => void;
  suppliers: Array<{ id: string; name: string }>;
  status: "" | ExpenseStatus;
  onStatusChange: (value: "" | ExpenseStatus) => void;
  hasFilters: boolean;
  onClear: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

/**
 * Salidas has more filters than a wrap-on-content bar holds: `Todos los
 * proveedores` and its neighbours needed a second column that broke the row.
 * One toolbar, one deterministic layout — the fields share a height and the
 * selects carry a one-word default so a filter name never has to be cut.
 */
export function ExpenseFilters({
  search,
  onSearchChange,
  month,
  onMonthChange,
  labelId,
  onLabelChange,
  labels,
  supplierId,
  onSupplierChange,
  suppliers,
  status,
  onStatusChange,
  hasFilters,
  onClear,
  viewMode,
  onViewModeChange,
}: Props) {
  return (
    <section
      aria-label="Filtros de salidas"
      className="rounded-xl border border-border/70 bg-card p-2 shadow-2xs"
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center xl:gap-1.5">
        <SearchField
          value={search}
          onChange={onSearchChange}
          placeholder="Buscar por descripción…"
          className="w-full xl:min-w-0 xl:flex-1"
        />

        {/* Phones and tablets: a two-column grid, with the month on its own row
            so `noviembre de 2026` is never clipped. The desktop row is one line,
            and its fields keep their width so a name is never cut to fit. */}
        <div className="grid grid-cols-2 gap-2 xl:flex xl:shrink-0 xl:items-center xl:gap-1.5">
          <div className="col-span-2 w-full xl:col-span-1 xl:w-40 xl:shrink-0">
            <Input
              type="month"
              aria-label="Mes"
              value={month}
              onChange={(event) => onMonthChange(event.target.value)}
              className="w-full cursor-pointer tabular-nums"
            />
          </div>
          <Select
            value={labelId}
            onChange={onLabelChange}
            className="w-full xl:w-36 xl:shrink-0"
            placeholder="Etiqueta"
            options={[
              { value: "", label: "Etiqueta" },
              ...labels.map((label) => ({
                value: label.id,
                label: label.name,
              })),
            ]}
          />
          <Select
            value={supplierId}
            onChange={onSupplierChange}
            className="w-full xl:w-36 xl:shrink-0"
            placeholder="Proveedor"
            options={[
              { value: "", label: "Proveedor" },
              ...suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              })),
            ]}
          />
          <Select
            value={status}
            onChange={(value) => onStatusChange(value as "" | ExpenseStatus)}
            className="w-full xl:w-28 xl:shrink-0"
            placeholder="Estado"
            options={[
              { value: "", label: "Estado" },
              { value: "PARTIAL", label: "Parcial" },
              { value: "PAID", label: "Pagado" },
            ]}
          />
        </div>

        {/* On the desktop row these two join the row; on phones the toggle hides
            itself (the card list is the only view there) and the clear sits below. */}
        <div className="flex items-center justify-between gap-2 xl:contents">
          {hasFilters && (
            <FilterClearButton onClick={onClear} className="h-9 shrink-0" />
          )}
          <ViewModeToggle
            value={viewMode}
            onChange={onViewModeChange}
            className="shrink-0"
          />
        </div>
      </div>
    </section>
  );
}
