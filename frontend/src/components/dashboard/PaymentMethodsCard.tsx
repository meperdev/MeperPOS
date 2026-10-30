"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart } from "recharts";
import { useSalesByPaymentMethod } from "@/hooks/useReports";
import { formatCurrency, formatPaymentMethod } from "@/lib/utils";

/**
 * The dashboard only ever reports three payment methods. There is no "Otros"
 * bucket: an unknown method is simply not invented here.
 */
const PAYMENT_METHODS = [
  { method: "CASH", label: formatPaymentMethod("CASH"), color: "#C25E36" },
  { method: "CARD", label: formatPaymentMethod("CARD"), color: "#2563EB" },
  { method: "TRANSFER", label: formatPaymentMethod("TRANSFER"), color: "#059669" },
] as const;

interface PaymentSlice {
  method: string;
  name: string;
  value: number;
  color: string;
  percentage: number;
  [key: string]: string | number;
}

/**
 * Donut of revenue by payment method for the selected window. The legend shows
 * each method's share and the centre shows the window total.
 */
export function PaymentMethodsCard({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const { data } = useSalesByPaymentMethod(startDate, endDate);

  const { slices, total } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of data?.data ?? []) {
      const key = row.paymentMethod?.toUpperCase().trim();
      if (!key) continue;
      totals.set(key, (totals.get(key) ?? 0) + (row.total ?? 0));
    }

    const grandTotal = PAYMENT_METHODS.reduce(
      (sum, entry) => sum + (totals.get(entry.method) ?? 0),
      0,
    );

    const built: PaymentSlice[] = PAYMENT_METHODS.map((entry) => {
      const value = totals.get(entry.method) ?? 0;
      return {
        method: entry.method,
        name: entry.label,
        value,
        color: entry.color,
        percentage: grandTotal > 0 ? Math.round((value / grandTotal) * 100) : 0,
      };
    });

    return { slices: built, total: grandTotal };
  }, [data]);

  return (
    <div
      data-testid="payment-methods-card"
      className="flex h-full min-h-0 flex-col"
    >
      <p className="text-sm font-semibold tracking-tight text-foreground">
        Métodos de pago
      </p>

      <div className="mt-3 flex min-h-0 flex-1 items-center gap-4">
        <div
          data-testid="payment-methods-chart"
          className="relative h-[136px] w-[136px] shrink-0"
        >
          <PieChart width={136} height={136}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius={43}
              outerRadius={64}
              paddingAngle={3}
              cornerRadius={3}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.method} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[11px] font-medium text-muted-foreground">
              Total
            </span>
            <span
              data-testid="payment-methods-total"
              className="max-w-[82px] truncate px-1 text-center font-mono text-xs font-semibold tracking-tight text-foreground tabular-nums sm:text-[13px]"
            >
              {formatCurrency(total)}
            </span>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-2">
          {slices.map((slice) => (
            <li
              key={slice.method}
              data-testid="payment-method-row"
              className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,5.5rem)] items-center gap-2 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="truncate font-medium text-foreground">
                  {slice.name}
                </span>
              </span>
              <span
                data-testid="payment-method-percentage"
                className="inline-flex w-10 items-center justify-center rounded-md border border-border/60 bg-muted/50 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground tabular-nums"
              >
                {slice.percentage}%
              </span>
              <span
                title={formatCurrency(slice.value)}
                className="min-w-0 truncate text-left font-mono text-[11px] font-semibold text-foreground tabular-nums"
              >
                {formatCurrency(slice.value)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
