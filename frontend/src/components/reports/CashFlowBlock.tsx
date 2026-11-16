"use client";

import { formatReportMoney, safeDecimalNumber } from "@/lib/reportPresentation";
import { cn } from "@/lib/utils";
import type { CashFlowReport } from "@/types";
import { QueryBody, type ReportQuery } from "./QuerySection";

/**
 * Cash in and cash out for the period. The net flow is the server's number; if
 * an older response does not carry it, the row is simply absent instead of
 * being re-derived in the browser.
 *
 * Content only — `CashPaymentsBlock` renders it inside the shared "Caja y
 * pagos" card, beside the payment mix, so both halves keep one frame.
 */
export function CashFlowBlock({ query }: { query: ReportQuery<CashFlowReport> }) {
  const data = query.data;

  return (
    <QueryBody
      query={query}
      loadingLabel="Cargando caja…"
      loadingRows={2}
      loadingColumns={2}
      errorMessage="No se pudo cargar caja"
      isEmpty={!data}
      emptyText="Sin movimientos de caja en el período."
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60">
          <div className="bg-card px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              <p className="text-[11px] text-muted-foreground">Plata que entró</p>
            </div>
            <p className="mt-1 truncate text-base font-semibold tracking-tight text-foreground tabular-nums">
              {formatReportMoney(data?.collections.total)}
            </p>
          </div>
          <div className="bg-card px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
              <p className="text-[11px] text-muted-foreground">Plata que salió</p>
            </div>
            <p className="mt-1 truncate text-base font-semibold tracking-tight text-foreground tabular-nums">
              {formatReportMoney(data?.expensePayments.total)}
            </p>
          </div>
        </div>

        {data?.netFlow != null && (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2.5 text-xs">
            <span className="font-medium text-muted-foreground">Flujo neto de caja</span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                safeDecimalNumber(data.netFlow) >= 0
                  ? "text-success-text"
                  : "text-danger-text",
              )}
            >
              {formatReportMoney(data.netFlow)}
            </span>
          </div>
        )}
      </div>
    </QueryBody>
  );
}
