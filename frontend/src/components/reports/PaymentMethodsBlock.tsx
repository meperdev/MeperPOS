"use client";

import { visiblePaymentMethods } from "@/lib/reportPresentation";
import { formatCurrency, formatPaymentMethod } from "@/lib/utils";
import type { ReportEnvelope, SaleByPaymentMethod } from "@/types";
import { chartSeriesColor } from "./chartColors";
import { QueryBody, type ReportQuery } from "./QuerySection";

/**
 * How the period was paid: one segmented bar and the figures underneath.
 * A method that collected nothing is not a row, so a single-method period does
 * not render two zero lines.
 *
 * Content only — `CashPaymentsBlock` renders it inside the shared "Caja y
 * pagos" card, beside the cash figures, so both halves keep one frame.
 */
export function PaymentMethodsBlock({
  query,
}: {
  query: ReportQuery<ReportEnvelope<SaleByPaymentMethod[]>>;
}) {
  const methods = visiblePaymentMethods(query.data?.data ?? []);
  const total = methods.reduce((sum, method) => sum + method.total, 0);

  return (
    <QueryBody
      query={query}
      loadingLabel="Cargando pagos…"
      loadingRows={4}
      loadingColumns={2}
      errorMessage="No se pudieron cargar pagos"
      isEmpty={methods.length === 0}
      emptyText="Sin pagos registrados en el período."
    >
      <div className="space-y-3">
        <div
          role="img"
          aria-label="Mezcla de ventas por método de pago"
          className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted"
        >
          {methods.map((method, index) => {
            const share = total > 0 ? method.total / total : 0;
            return (
              <div
                key={method.paymentMethod}
                title={`${formatPaymentMethod(method.paymentMethod)}: ${Math.round(share * 100)}%`}
                style={{
                  width: `${share * 100}%`,
                  backgroundColor: chartSeriesColor(index),
                }}
              />
            );
          })}
        </div>

        <ul className="divide-y divide-border/40">
          {methods.map((method, index) => {
            const share = total > 0 ? method.total / total : 0;
            return (
              <li
                key={method.paymentMethod}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: chartSeriesColor(index) }}
                  />
                  <span className="truncate text-[13px] text-foreground">
                    {formatPaymentMethod(method.paymentMethod)}
                  </span>
                  <span className="text-[13px] text-muted-foreground tabular-nums">
                    {Math.round(share * 100)}%
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-[13px] text-muted-foreground tabular-nums">
                    {method.count} {method.count === 1 ? "pago" : "pagos"}
                  </span>
                  <span className="text-[13px] font-semibold text-foreground tabular-nums">
                    {formatCurrency(method.total)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </QueryBody>
  );
}
