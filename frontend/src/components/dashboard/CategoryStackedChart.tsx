"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { X } from "lucide-react";
import { useSalesByCategoryDaily } from "@/hooks/useReports";
import { formatCurrency } from "@/lib/utils";
import {
  buildCategoryColorMap,
  buildDateWindow,
  buildStackedDailySeries,
  countDaysInclusive,
  formatCategoryAmountTick,
  formatCategoryAxisTick,
  formatCategoryTooltipDate,
  type StackedDay,
} from "@/lib/dashboard";

/** One chart row: the day's total plus one numeric field per category. */
interface CategoryChartRow {
  date: string;
  total: number;
  [category: string]: number | string;
}

/** Shape Recharts hands to a custom tooltip content component. */
interface CategoryTooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: CategoryChartRow;
}

interface CategoryTooltipContentProps {
  active?: boolean;
  payload?: CategoryTooltipEntry[];
  coordinate?: { x?: number; y?: number };
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
}

/**
 * Recharts tooltip content: the hovered day's total plus its per-category
 * breakdown in a dark-glass card that follows the active bar dynamically.
 */
export function CategoryTooltipContent({
  active,
  payload,
}: CategoryTooltipContentProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const row = payload[0]?.payload;
  const total =
    typeof row?.total === "number"
      ? row.total
      : payload.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
  const segments = payload.filter((entry) => Number(entry.value) > 0);

  return (
    <div
      data-testid="category-tooltip"
      className="pointer-events-none min-w-[175px] rounded-lg border border-border/80 bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur-xs text-foreground animate-in fade-in-0 duration-300 ease-out"
    >
      <p className="text-[11px] font-medium text-muted-foreground capitalize">
        {formatCategoryTooltipDate(typeof row?.date === "string" ? row.date : "")}
      </p>
      <p className="mt-0.5 text-base font-semibold font-mono text-foreground tabular-nums">
        {formatCurrency(total)}
      </p>
      {segments.length > 0 && (
        <ul className="mt-2 divide-y divide-border/50">
          {segments.map((entry) => (
            <li
              key={String(entry.dataKey)}
              className="flex items-center justify-between gap-3 py-1 text-[11px]"
            >
              <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <span
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.name ?? entry.dataKey}
              </span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
                {formatCurrency(Number(entry.value))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface CategoryDayDetailModalProps {
  day: StackedDay | null;
  onClose: () => void;
  colorMap: Map<string, string>;
}

/**
 * Modal triggered when clicking a day on the bar chart.
 * Uses createPortal to render outside any parent container transforms,
 * locks body scroll, and offers a spacious, detailed breakdown in both themes.
 */
export function CategoryDayDetailModal({
  day,
  onClose,
  colorMap,
}: CategoryDayDetailModalProps) {
  useEffect(() => {
    if (!day) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [day, onClose]);

  if (!day || typeof document === "undefined") return null;

  const totalQuantity = day.segments.reduce((sum, s) => sum + s.quantity, 0);
  const activeSegments = day.segments.filter((s) => s.total > 0);

  return createPortal(
    <div
      data-testid="category-day-detail-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6 backdrop-blur-xs overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="category-day-detail-modal"
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl rounded-2xl border border-border/80 bg-card p-6 sm:p-7 shadow-2xl text-foreground my-auto animate-in fade-in-0 zoom-in-95 duration-150 ease-out"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              Detalle del día
            </p>
            <h3 className="text-xl sm:text-2xl font-semibold text-foreground capitalize mt-0.5 tracking-tight truncate">
              {formatCategoryTooltipDate(day.date)}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="h-8 w-8 rounded-lg border border-border/60 bg-muted/40 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary metrics: Total recaudado gets double width so large COP figures never overflow */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-6 rounded-xl border border-border/60 bg-muted/30 p-3.5 min-w-0">
            <span className="text-xs font-medium text-muted-foreground block">
              Total recaudado
            </span>
            <p className="mt-1 text-xl sm:text-2xl font-semibold font-mono text-foreground tabular-nums tracking-tight whitespace-nowrap">
              {formatCurrency(day.total)}
            </p>
            <span className="text-[11px] text-muted-foreground block mt-0.5">
              Ventas del día
            </span>
          </div>

          <div className="sm:col-span-3 rounded-xl border border-border/60 bg-muted/30 p-3.5 min-w-0">
            <span className="text-xs font-medium text-muted-foreground block">
              Unidades
            </span>
            <p className="mt-1 text-xl sm:text-2xl font-semibold font-mono text-foreground tabular-nums tracking-tight">
              {totalQuantity}
            </p>
            <span className="text-[11px] text-muted-foreground block mt-0.5">
              {totalQuantity} {totalQuantity === 1 ? "unidad" : "unidades"}
            </span>
          </div>

          <div className="sm:col-span-3 rounded-xl border border-border/60 bg-muted/30 p-3.5 min-w-0">
            <span className="text-xs font-medium text-muted-foreground block">
              Categorías
            </span>
            <p className="mt-1 text-xl sm:text-2xl font-semibold font-mono text-foreground tabular-nums tracking-tight">
              {activeSegments.length}
            </p>
            <span className="text-[11px] text-muted-foreground block mt-0.5">
              {activeSegments.length === 1 ? "categoría activa" : "categorías activas"}
            </span>
          </div>
        </div>

        {/* Breakdown by category */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-foreground">
              Desglose por categoría
            </span>
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              {activeSegments.length}{" "}
              {activeSegments.length === 1 ? "categoría activa" : "categorías activas"}
            </span>
          </div>

          {activeSegments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
              Sin ventas registradas en esta fecha.
            </div>
          ) : (
            <ul className="space-y-2 max-h-80 sm:max-h-96 overflow-y-auto scrollbar-app pr-1">
              {activeSegments.map((segment) => {
                const color = colorMap.get(segment.category) ?? "#C25E36";
                const percentage =
                  day.total > 0 ? Math.round((segment.total / day.total) * 100) : 0;

                return (
                  <li
                    key={segment.category}
                    className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-medium text-sm text-foreground truncate">
                        <span
                          className="inline-block h-3 w-3 rounded-[3px] shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate">{segment.category}</span>
                      </span>
                      <span className="font-mono font-semibold text-sm text-foreground tabular-nums shrink-0">
                        {formatCurrency(segment.total)}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${percentage}%`, backgroundColor: color }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground tabular-nums shrink-0">
                        <span>
                          {segment.quantity} {segment.quantity === 1 ? "ud" : "uds"}
                        </span>
                        <span>·</span>
                        <span className="text-foreground font-semibold">{percentage}%</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg border border-border/70 bg-muted/40 hover:bg-muted py-2.5 text-xs font-semibold text-foreground transition-colors text-center"
        >
          Cerrar
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Stacked daily revenue by category, rebuilt on Recharts. It fetches its own
 * window (`useSalesByCategoryDaily`) and derives the title, axis and series from
 * `startDate`/`endDate`, so it no longer hardcodes a month.
 */
export function CategoryStackedChart({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const { data } = useSalesByCategoryDaily(startDate, endDate);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(500);
  const [selectedDay, setSelectedDay] = useState<StackedDay | null>(null);
  const hoveredDayRef = useRef<StackedDay | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (el.clientWidth > 0) {
      setChartWidth(el.clientWidth);
    }

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        setChartWidth(Math.round(entry.contentRect.width));
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const days = useMemo(
    () => buildDateWindow(endDate, countDaysInclusive(startDate, endDate)),
    [startDate, endDate],
  );

  const rows = data?.data;
  const series = useMemo(() => buildStackedDailySeries(rows, days), [rows, days]);
  const colorMap = useMemo(
    () => buildCategoryColorMap(rows?.map((row) => row.category)),
    [rows],
  );
  const categories = useMemo(() => Array.from(colorMap.keys()), [colorMap]);

  const chartData = useMemo<CategoryChartRow[]>(
    () =>
      series.map((day) => {
        const row: CategoryChartRow = { date: day.date, total: day.total };
        for (const segment of day.segments) {
          row[segment.category] = segment.total;
        }
        return row;
      }),
    [series],
  );

  const windowTotal = useMemo(
    () => series.reduce((sum, day) => sum + day.total, 0),
    [series],
  );

  const isDenseRange = days.length > 15;
  const barSize = days.length <= 7 ? 32 : days.length <= 15 ? 20 : 12;
  const tooltipOffset = Math.max(
    18,
    Math.round((chartWidth - 24) / Math.max(days.length, 1) / 2) + 8,
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-visible">
      <div className="flex items-start justify-between gap-2">
        <p
          data-testid="category-chart-title"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Ingresos por categoría
        </p>
        <span
          data-testid="category-chart-range"
          className="shrink-0 rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums"
        >
          Últimos {days.length} días
        </span>
      </div>

      <div className="sr-only" data-testid="category-chart-summary">
        <p>
          {`Ingresos por categoría de los últimos ${days.length} días: ${formatCurrency(windowTotal)} en total.`}
        </p>
        <table>
          <caption>Ventas por día</caption>
          <thead>
            <tr>
              <th scope="col">Día</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {series.map((day) => (
              <tr key={day.date}>
                <td>{formatCategoryTooltipDate(day.date)}</td>
                <td>{formatCurrency(day.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        ref={containerRef}
        data-testid="category-stacked-chart"
        data-day-count={series.length}
        data-start-date={startDate}
        data-end-date={endDate}
        className="mt-4 min-h-0 w-full flex-1 overflow-visible relative cursor-pointer"
        onClick={() => {
          if (hoveredDayRef.current) {
            setSelectedDay(hoveredDayRef.current);
          }
        }}
      >
        <BarChart
          width={chartWidth}
          height={300}
          data={chartData}
          barSize={barSize}
          margin={{ top: 12, right: 12, bottom: 0, left: 12 }}
          accessibilityLayer
          className="cursor-pointer"
          onMouseMove={(state) => {
            if (typeof state?.activeLabel === "string") {
              const match = series.find((s) => s.date === state.activeLabel);
              if (match) hoveredDayRef.current = match;
            } else {
              const rawIdx = state?.activeTooltipIndex ?? state?.activeIndex;
              if (rawIdx !== undefined && rawIdx !== null) {
                const idx = Number(rawIdx);
                if (!isNaN(idx) && series[idx]) {
                  hoveredDayRef.current = series[idx];
                }
              }
            }
          }}
          onMouseLeave={() => {
            hoveredDayRef.current = null;
          }}
          onClick={(state) => {
            if (typeof state?.activeLabel === "string") {
              const match = series.find((s) => s.date === state.activeLabel);
              if (match) {
                setSelectedDay(match);
                return;
              }
            }
            const rawIdx = state?.activeTooltipIndex ?? state?.activeIndex;
            if (rawIdx !== undefined && rawIdx !== null) {
              const idx = Number(rawIdx);
              if (!isNaN(idx) && series[idx]) {
                setSelectedDay(series[idx]);
                return;
              }
            }
            if (hoveredDayRef.current) {
              setSelectedDay(hoveredDayRef.current);
            }
          }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
            strokeOpacity={0.4}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            tickMargin={6}
            tickFormatter={(value: number) => formatCategoryAmountTick(Number(value))}
            tick={{
              fontSize: 10,
              fill: "var(--muted-foreground)",
              fontFamily: "var(--font-jetbrains-mono)",
            }}
          />
          <XAxis
            dataKey="date"
            interval={0}
            tickFormatter={formatCategoryAxisTick}
            tickLine={{ stroke: "var(--border)", strokeOpacity: 0.45 }}
            tickSize={4}
            tickMargin={6}
            height={isDenseRange ? 38 : 30}
            angle={isDenseRange ? -35 : 0}
            textAnchor={isDenseRange ? "end" : "middle"}
            axisLine={{ stroke: "var(--border)", strokeOpacity: 0.5 }}
            tick={{
              fontSize: isDenseRange ? 9.5 : 11,
              fill: "var(--muted-foreground)",
            }}
          />
          <Tooltip
            offset={tooltipOffset}
            position={{ y: 8 }}
            isAnimationActive={true}
            animationDuration={380}
            animationEasing="ease-out"
            allowEscapeViewBox={{ x: false, y: false }}
            wrapperStyle={{
              zIndex: 50,
              outline: "none",
              pointerEvents: "none",
              transition:
                "transform 380ms cubic-bezier(0.16, 1, 0.3, 1), opacity 260ms ease-out",
            }}
            cursor={{ fill: "var(--primary)", fillOpacity: 0.08, rx: 8, ry: 8 }}
            content={<CategoryTooltipContent />}
          />
          {categories.map((category) => (
            <Bar
              key={category}
              dataKey={category}
              stackId="revenue"
              fill={colorMap.get(category)}
              // No per-segment stroke: on slivers the card-coloured outline ate
              // the block and made the stack look misaligned.
              stroke="none"
              minPointSize={2}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(barData) => {
                const date = (barData?.payload as CategoryChartRow | undefined)?.date;
                const match = series.find((s) => s.date === date);
                if (match) setSelectedDay(match);
              }}
            />
          ))}
        </BarChart>
      </div>

      {/* Day Detail Mini Modal */}
      <CategoryDayDetailModal
        day={selectedDay}
        onClose={() => setSelectedDay(null)}
        colorMap={colorMap}
      />
    </div>
  );
}
