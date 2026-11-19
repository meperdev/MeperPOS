import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Area, AreaChart } from "recharts";
import { cn } from "@/lib/utils";

export type MetricCardTone = "primary" | "accent" | "rose" | "green" | "blue";

export interface MetricCardDelta {
  percentage: number | null;
  label?: string;
}

export interface MetricCardAction {
  label: string;
  onClick: () => void;
}

interface MetricCardProps {
  label: string;
  value: string;
  helper: string;
  delta?: MetricCardDelta;
  tone?: MetricCardTone;
  /** Last 7 daily values (oldest → newest) rendered as an inline sparkline. */
  sparkline?: number[];
  /** Optional CTA rendered at the card footer (e.g. "Reordenar"). */
  action?: MetricCardAction;
}

const toneCardClasses: Record<MetricCardTone, string> = {
  primary: "border-border/70 bg-card hover:border-border transition-colors",
  accent: "border-border/70 bg-card hover:border-border transition-colors",
  rose: "border-danger/30 bg-card hover:border-danger/40 transition-colors",
  green: "border-border/70 bg-card hover:border-border transition-colors",
  blue: "border-border/70 bg-card hover:border-border transition-colors",
};

const toneValueClasses: Record<MetricCardTone, string> = {
  primary: "text-foreground",
  accent: "text-foreground",
  rose: "text-danger-text",
  green: "text-foreground",
  blue: "text-foreground",
};

// Chart colours come from the status and brand tokens, never from palette hexes.
const toneSparkColor: Record<MetricCardTone, string> = {
  primary: "var(--primary)",
  accent: "var(--primary)",
  rose: "var(--danger)",
  green: "var(--success)",
  blue: "var(--info)",
};

const toneActionClasses: Record<MetricCardTone, string> = {
  primary: "border-border/80 bg-muted/40 text-foreground hover:bg-muted",
  accent: "border-border/80 bg-muted/40 text-foreground hover:bg-muted",
  rose: "border-danger/30 bg-danger/10 text-danger-text hover:bg-danger/15",
  green: "border-border/80 bg-muted/40 text-foreground hover:bg-muted",
  blue: "border-border/80 bg-muted/40 text-foreground hover:bg-muted",
};

const NEUTRAL_SPARK_COLOR = "var(--muted-foreground)";

/**
 * Tiny axis-less area chart used as a KPI sparkline. It sets a percentage width
 * directly on the chart (instead of wrapping it in a ResponsiveContainer) so it
 * stays fluid without needing a ResizeObserver — which jsdom does not provide.
 */
function MetricSparkline({ values, color }: { values: number[]; color: string }) {
  const data = values.map((value, index) => ({ index, value }));

  return (
    <div
      data-testid="metric-sparkline"
      aria-hidden="true"
      className="mt-2 h-8 w-full"
    >
      <AreaChart
        width="100%"
        height={32}
        data={data}
        margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
        style={{ pointerEvents: "none" }}
      >
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={color}
          fillOpacity={0.15}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </div>
  );
}

/**
 * Shared MetricCard for reports and dashboard: muted label, semibold tabular
 * value, helper line and an optional delta pill, with tone alternation.
 *
 * The label and value stay anchored at the top: the footer is pushed down with
 * `mt-auto` instead of distributing the free space, so a card stretched by its
 * grid row (or by an action button in a sibling card) never floats the number
 * in the middle.
 *
 * When no `tone` is provided it renders exactly like the historical reports
 * MetricCard (neutral card surface), so refactors are behavior-preserving.
 * `sparkline` and `action` are additive and optional; omitting both keeps the
 * original markup unchanged.
 */
export function MetricCard({
  label,
  value,
  helper,
  delta,
  tone,
  sparkline,
  action,
}: MetricCardProps) {
  const percentage = delta?.percentage ?? null;
  const hasBaseline = percentage !== null;
  const positive = (percentage ?? 0) >= 0;
  const deltaLabel =
    delta?.label ??
    (percentage === null
      ? "Sin base"
      : `${positive ? "+" : ""}${percentage.toFixed(1)}%`);

  return (
    <div
      data-tone={tone ?? "neutral"}
      className={
        tone
          ? cn(
              "rounded-xl border p-3 sm:p-4 shadow-2xs flex flex-col",
              toneCardClasses[tone],
            )
          : "rounded-xl border border-border/70 bg-card p-3 sm:p-4 shadow-2xs flex flex-col"
      }
    >
      <p className="text-[13px] font-medium text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 truncate text-lg font-semibold text-foreground tracking-tight tabular-nums sm:text-2xl",
          tone && toneValueClasses[tone],
        )}
        title={value}
      >
        {value}
      </p>
      {sparkline && sparkline.length > 0 && (
        <MetricSparkline
          values={sparkline}
          color={tone ? toneSparkColor[tone] : NEUTRAL_SPARK_COLOR}
        />
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[13px]">
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
              !hasBaseline
                ? "bg-muted/70 text-muted-foreground border border-border/70"
                : positive
                  ? "bg-success/10 text-success-text border border-success/30"
                  : "bg-danger/10 text-danger-text border border-danger/30",
            )}
          >
            {hasBaseline && (
              <span aria-hidden="true">
                {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              </span>
            )}
            {deltaLabel}
          </span>
        ) : (
          <span />
        )}
        <span className="text-right text-xs text-muted-foreground">{helper}</span>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={cn(
            "mt-3 inline-flex min-h-9 items-center gap-1 self-start rounded-md border px-3 py-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            tone
              ? toneActionClasses[tone]
              : "border-border/70 bg-muted/40 text-foreground hover:bg-muted",
          )}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
