"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, ListTodo, Receipt, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useExpenses } from "@/hooks/useExpenses";
import { useTasks } from "@/hooks/useTasks";
import { computePendingAmount, filterOpenTasks } from "@/lib/dashboard";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Expense } from "@/types";

/** Compact cap: the panels are a peek, not a list page. */
const VISIBLE_CAP = 2;

function PanelHeader({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <p className="text-sm font-semibold tracking-tight text-foreground">
          {title}
        </p>
      </div>
    </div>
  );
}

type ExpenseLike = Pick<Expense, "id" | "description" | "total" | "status"> & {
  payments?: Array<{ amount: number }>;
};

/**
 * Two compact operational panels side by side. Low-stock now lives on the
 * "Stock crítico" KPI card in `TodayStats` (it owns the Reordenar action), so
 * it is intentionally not duplicated here.
 */
export function AlertPanels() {
  const router = useRouter();
  const { data: expensesResponse } = useExpenses({ status: "PARTIAL" });
  const { data: tasksResponse } = useTasks();

  const partialExpenses = (expensesResponse?.data ?? []) as ExpenseLike[];
  const openTasks = filterOpenTasks(tasksResponse?.tasks ?? [], VISIBLE_CAP);

  const totalPending = partialExpenses.reduce(
    (sum, expense) => sum + computePendingAmount(expense),
    0,
  );

  const visibleExpenses = partialExpenses.slice(0, VISIBLE_CAP);

  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
      {/* Partial expenses panel */}
      <div className="min-w-0 flex flex-col justify-between rounded-xl border border-border/70 bg-card px-4 py-4 text-foreground hover:border-border transition-colors">
        <div>
          <PanelHeader
            icon={<Receipt className="h-4 w-4" />}
            title="Gastos por pagar"
          />
          <div className="mt-3">
            {partialExpenses.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin gastos pendientes</p>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {visibleExpenses.map((expense) => (
                    <li
                      key={expense.id}
                      className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/35 px-3 py-2"
                    >
                      <span className="truncate text-sm font-medium text-foreground">
                        {expense.description || "Gasto"}
                      </span>
                      <span className="shrink-0 font-mono text-xs font-semibold text-foreground tabular-nums">
                        {formatCurrency(computePendingAmount(expense))}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2.5 flex items-center justify-between rounded-lg border border-border/60 bg-muted/50 px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Total pendiente
                  </span>
                  <span className="font-mono text-sm font-semibold text-primary-text tabular-nums">
                    {formatCurrency(totalPending)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
        {(partialExpenses.length > VISIBLE_CAP || partialExpenses.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {partialExpenses.length > VISIBLE_CAP && (
              <button
                type="button"
                onClick={() => router.push("/expenses")}
                className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-muted"
              >
                Ver {partialExpenses.length - VISIBLE_CAP} más
              </button>
            )}
            {partialExpenses.length > 0 && (
              <button
                type="button"
                onClick={() => router.push("/expenses")}
                className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-muted"
              >
                Ver gastos
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Open tasks panel */}
      <div className="min-w-0 flex flex-col justify-between rounded-xl border border-border/70 bg-card px-4 py-4 text-foreground hover:border-border transition-colors">
        <div>
          <PanelHeader
            icon={<ListTodo className="h-4 w-4" />}
            title="Tareas abiertas"
          />
          <div className="mt-3">
            {openTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin tareas abiertas</p>
            ) : (
              <ul className="space-y-1.5">
                {openTasks.map((task) => {
                  const Icon = task.status === "IN_PROGRESS" ? ShoppingBag : ListTodo;
                  return (
                    <li
                      key={task.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/35 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate text-sm font-medium text-foreground">
                          {task.title}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge variant={task.status === "IN_PROGRESS" ? "primary" : "warning"}>
                          {task.status === "IN_PROGRESS" ? "En progreso" : "Pendiente"}
                        </Badge>
                        {task.dueDate && (
                          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                            {formatDate(task.dueDate)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/tasks")}
          className="mt-3 inline-flex items-center gap-1.5 self-start rounded-md border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-muted"
        >
          Ver tareas
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
