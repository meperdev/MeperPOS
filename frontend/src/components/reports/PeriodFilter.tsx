"use client";

import type { ReactNode } from "react";
import { Calendar } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { FilterGroup, FilterOptionButton } from "@/components/ui/FilterBar";
import {
  activeReportPeriodPresetId,
  normalizeReportPeriod,
  type ReportPeriodPreset,
} from "@/lib/reportPresentation";

/**
 * The window every Análisis block shares. There is no "all time" option on
 * purpose: the same range goes to each endpoint, so no block can silently mean
 * something different by "todo".
 */
export function PeriodFilter({
  presets,
  startDate,
  endDate,
  appliedLabel,
  onChange,
}: {
  presets: ReportPeriodPreset[];
  startDate: string;
  endDate: string;
  /** Server-confirmed range, so the label never promises a window it did not get. */
  appliedLabel: ReactNode;
  onChange: (range: { startDate: string; endDate: string }) => void;
}) {
  const activeId = activeReportPeriodPresetId(presets, startDate, endDate);

  const commit = (nextStart: string, nextEnd: string) => {
    const normalized = normalizeReportPeriod(nextStart, nextEnd);
    if (normalized) onChange(normalized);
  };

  return (
    <section
      className="rounded-xl border border-border/70 bg-card p-2.5 shadow-2xs"
      aria-label="Filtros de período"
    >
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup label="Período">
          {presets.map((preset) => (
            <FilterOptionButton
              key={preset.id}
              active={activeId === preset.id}
              onClick={() =>
                onChange({ startDate: preset.startDate, endDate: preset.endDate })
              }
            >
              {preset.label}
            </FilterOptionButton>
          ))}
        </FilterGroup>

        {/* Two equal tracks on phones so neither date can push past the screen edge. */}
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="reports-start"
            >
              Desde
            </label>
            <Input
              id="reports-start"
              type="date"
              value={startDate}
              onChange={(event) => commit(event.target.value, endDate)}
              className="min-w-0 w-full sm:w-40"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="reports-end"
            >
              Hasta
            </label>
            <Input
              id="reports-end"
              type="date"
              value={endDate}
              onChange={(event) => commit(startDate, event.target.value)}
              className="min-w-0 w-full sm:w-40"
            />
          </div>
        </div>

        <span className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground tabular-nums">
          <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
          {appliedLabel}
        </span>
      </div>
    </section>
  );
}
