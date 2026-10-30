import { formatCurrency } from "@/lib/utils";
import { Wallet, TrendingDown } from "lucide-react";
import type { ExpenseMonthlySummary } from "@/types";

interface Props {
  month?: string;
  summary?: ExpenseMonthlySummary;
}

export function ExpenseSummaryCards({ month, summary }: Props) {
  const groups = summary?.groups ?? [];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 lg:gap-4">
      {/* Total Card */}
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs flex flex-col justify-between hover:border-border transition-colors">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              Total del Mes
            </p>
            <Wallet className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
          <p className="mt-2.5 text-xl sm:text-2xl font-semibold font-mono text-foreground tracking-tight tabular-nums">
            {formatCurrency(Number(summary?.total ?? 0))}
          </p>
        </div>
        <div className="mt-3.5 pt-2.5 border-t border-border/50 text-[11px] text-muted-foreground font-mono space-y-1">
          {month && (
            <div className="flex items-center justify-between">
              <span>Período: {month}</span>
              <span className="font-medium text-foreground tabular-nums">
                {groups.length} {groups.length === 1 ? "grupo" : "grupos"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Top 2 Expense Groups */}
      {groups.slice(0, 2).map((group) => (
        <div
          key={group.groupId}
          className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs flex flex-col justify-between hover:border-border transition-colors"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground truncate">
                {group.name}
              </p>
              <TrendingDown className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
            <p className="mt-2.5 text-xl sm:text-2xl font-semibold font-mono text-foreground tracking-tight tabular-nums">
              {formatCurrency(Number(group.total ?? 0))}
            </p>
          </div>
          <div className="mt-3.5 pt-2.5 border-t border-border/50 text-[11px] text-muted-foreground font-mono space-y-1">
            <span className="text-[11px] text-muted-foreground/80 block">Gasto acumulado</span>
            {(group.labels ?? []).slice(0, 3).map((label) => (
              <div key={label.labelId} className="flex items-center justify-between gap-2 truncate">
                <span className="truncate">{label.name}</span>
                <span className="font-medium text-foreground tabular-nums shrink-0">
                  {formatCurrency(Number(label.total ?? 0))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Empty State when no groups have recorded expenses */}
      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-5 flex flex-col items-center justify-center text-center sm:col-span-1 lg:col-span-2">
          <TrendingDown className="w-5 h-5 text-muted-foreground mb-2" />
          <p className="text-xs font-medium text-muted-foreground">
            No hay salidas registradas por categoría para este período
          </p>
        </div>
      )}
    </section>
  );
}
