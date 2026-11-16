/**
 * Categorical chart scale from `globals.css`. Categories are not states, so the
 * status tokens are never reused here.
 */
export const CHART_SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
] as const;

/** The catch-all slice keeps its own neutral colour so it reads as "the rest". */
export const CHART_OTHER_COLOR = "var(--chart-8)";

export function chartSeriesColor(index: number) {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length];
}
