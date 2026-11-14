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
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {/* Every card has the same three parts: title, value and a two-line
          footnote, so the strip reads as one row instead of three heights. */}
      <div className="rounded-xl border border-border/70 bg-card p-3 shadow-2xs flex h-full flex-col">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Total del mes
          </p>
          <Wallet className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>
        <p className="mt-2 text-xl font-semibold font-mono text-foreground tracking-tight tabular-nums">
          {formatCurrency(Number(summary?.total ?? 0))}
        </p>
        <div className="mt-auto border-t border-border/50 pt-2 text-[11px] text-muted-foreground font-mono">
          <p className="text-[10px] font-medium text-muted-foreground/60">Resumen</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate tabular-nums">Período: {month ?? "—"}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span>Grupos</span>
            <span className="font-medium text-foreground tabular-nums">
              {groups.length}
            </span>
          </div>
        </div>
      </div>

      {groups.slice(0, 2).map((group) => {
        const labels = (group.labels ?? []).slice(0, 2);
        return (
          <div
            key={group.groupId}
            className="rounded-xl border border-border/70 bg-card p-3 shadow-2xs flex h-full flex-col"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground truncate">
                {group.name}
              </p>
              <TrendingDown className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
            <p className="mt-2 text-xl font-semibold font-mono text-foreground tracking-tight tabular-nums">
              {formatCurrency(Number(group.total ?? 0))}
            </p>
            <div className="mt-auto border-t border-border/50 pt-2 text-[11px] text-muted-foreground font-mono">
              <p className="text-[10px] font-medium text-muted-foreground/60">
                Gasto acumulado
              </p>
              {[0, 1].map((slot) => {
                const label = labels[slot];
                return (
                  <div
                    key={slot}
                    className="mt-1 flex min-h-[14px] items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      {label?.name ?? (slot === 0 ? "Sin etiquetas" : " ")}
                    </span>
                    {label && (
                      <span className="shrink-0 font-medium text-foreground tabular-nums">
                        {formatCurrency(Number(label.total ?? 0))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-3 flex h-full flex-col items-center justify-center text-center sm:col-span-1 lg:col-span-2">
          <TrendingDown className="w-5 h-5 text-muted-foreground mb-2" />
          <p className="text-xs font-medium text-muted-foreground">
            No hay salidas registradas por categoría para este período
          </p>
        </div>
      )}
    </section>
  );
}
