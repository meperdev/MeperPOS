"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart } from "recharts";
import { useSalesByPaymentMethod } from "@/hooks/useReports";
import { cn, formatCurrency, formatPaymentMethod } from "@/lib/utils";

/**
 * The dashboard only ever reports three payment methods. There is no "Otros"
 * bucket: an unknown method is simply not invented here. Inks come from the
 * series tokens — terracotta, sand and sage — so the ring stays warm instead of
 * borrowing the status green and blue.
 */
const PAYMENT_METHODS = [
  { method: "CASH", label: formatPaymentMethod("CASH"), color: "var(--primary)" },
  { method: "CARD", label: formatPaymentMethod("CARD"), color: "var(--chart-ink)" },
  { method: "TRANSFER", label: formatPaymentMethod("TRANSFER"), color: "var(--chart-ink-muted)" },
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
 * One donut at one size. Recharts takes pixel numbers, so the two compositions
 * (compact and wide) each own a chart instance; only the compact one carries
 * the testids so the queries stay unique.
 */
function Donut({
  slices,
  total,
  px,
  innerRadius,
  outerRadius,
  totalClassName,
  className,
  testId,
  totalTestId,
}: {
  slices: PaymentSlice[];
  total: number;
  px: number;
  innerRadius: number;
  outerRadius: number;
  totalClassName: string;
  className?: string;
  testId?: string;
  totalTestId?: string;
}) {
  return (
    <div
      data-testid={testId}
      aria-hidden="true"
      className={cn("relative shrink-0", className)}
    >
      <PieChart width={px} height={px}>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
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
        <span className="text-xs font-medium text-muted-foreground">
          Total
        </span>
        <span
          data-testid={totalTestId}
          className={cn(
            "truncate px-1 text-center font-semibold tracking-tight text-foreground tabular-nums",
            totalClassName,
          )}
        >
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );
}

/**
 * Donut of revenue by payment method for the selected window, with the legend
 * beside it. The card is its own container: the dashboard drops it into a wide
 * phone column and into a narrow 2/5 desktop cell alike, so the card's width —
 * not the viewport's — decides the composition. Narrow keeps the donut at 96px
 * and gives each method two lines (full name, then amount + share), which is
 * what keeps "Transferencia" whole instead of collapsing to one letter inside
 * the ~245px desktop cell.
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
      className="@container flex h-full min-h-0 flex-col"
    >
      <p className="text-sm font-semibold tracking-tight text-foreground">
        Métodos de pago
      </p>

      <div className="mt-3 flex min-h-0 flex-1 flex-row items-center gap-3 @[26rem]:gap-4">
        <Donut
          slices={slices}
          total={total}
          px={96}
          innerRadius={32}
          outerRadius={46}
          totalClassName="max-w-[62px] text-xs"
          className="@[26rem]:hidden"
          testId="payment-methods-chart"
          totalTestId="payment-methods-total"
        />
        <Donut
          slices={slices}
          total={total}
          px={136}
          innerRadius={43}
          outerRadius={64}
          totalClassName="max-w-[82px] text-sm"
          className="hidden @[26rem]:block"
          testId="payment-methods-chart-wide"
        />

        <ul className="min-w-0 flex-1 space-y-2.5">
          {slices.map((slice) => (
            <li
              key={slice.method}
              data-testid="payment-method-row"
              className="grid grid-cols-[0.625rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-sm @[26rem]:grid-cols-[0.625rem_minmax(0,1fr)_auto_auto]"
            >
              <span
                className="col-start-1 row-start-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: slice.color }}
              />
              {/* Narrow: the name owns line one outright; the amount and a
                  plain-text share share line two, so no amount ever ellipsizes. */}
              <span className="col-start-2 row-start-1 min-w-0 truncate text-sm font-medium text-foreground">
                {slice.name}
              </span>
              <span
                data-testid="payment-method-percentage"
                className="col-start-3 row-start-1 hidden w-11 items-center justify-center rounded-md border border-border/60 bg-muted/50 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums @[26rem]:inline-flex"
              >
                {slice.percentage}%
              </span>
              <span
                title={formatCurrency(slice.value)}
                className="col-start-2 row-start-2 whitespace-nowrap text-[13px] font-semibold text-foreground tabular-nums @[26rem]:col-start-4 @[26rem]:row-start-1 @[26rem]:text-right @[26rem]:text-sm"
              >
                {formatCurrency(slice.value)}{" "}
                <span
                  data-testid="payment-method-percentage-compact"
                  className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums @[26rem]:hidden"
                >
                  {slice.percentage}%
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
