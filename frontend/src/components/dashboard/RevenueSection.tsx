"use client";

import { useMemo, useState } from "react";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { CategoryStackedChart } from "./CategoryStackedChart";
import { PaymentMethodsCard } from "./PaymentMethodsCard";
import { TopProductsCard } from "./TopProductsCard";
import {
  DASHBOARD_RANGES,
  DEFAULT_DASHBOARD_RANGE,
  resolveDashboardRange,
  type DashboardRangeKey,
} from "@/lib/dashboard";
import { getBogotaDateInputValue } from "@/lib/utils";

const RANGE_OPTIONS = DASHBOARD_RANGES.map((range) => ({
  value: range.key,
  label: range.label,
}));

export function RevenueSection() {
  return <RevenueSectionInner today={getBogotaDateInputValue()} />;
}

/**
 * One 60/40 revenue piece: a shared range selector driving three cards. The
 * piece owns the range state and hands each child the resolved `startDate` /
 * `endDate`; every child fetches its own data.
 *
 * Height is fixed on `lg` (`lg:h-[26rem]`) so switching the range — which only
 * changes the number of bars, not the number of cards — never resizes the
 * section. Children are `h-full` + `min-h-0` and clip their overflow, so their
 * content cannot push the piece taller.
 */
export function RevenueSectionInner({ today }: { today: string }) {
  const [range, setRange] = useState<DashboardRangeKey>(DEFAULT_DASHBOARD_RANGE);
  const { startDate, endDate } = useMemo(
    () => resolveDashboardRange(range, today),
    [range, today],
  );

  return (
    <section data-testid="revenue-section" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold tracking-tight text-foreground">
          Ingresos
        </p>
        <div className="w-36">
          <BentoSelect
            options={RANGE_OPTIONS}
            value={range}
            onChange={(value) => setRange(value as DashboardRangeKey)}
            placeholder="Rango"
          />
        </div>
      </div>

      <div className="mt-2.5 grid gap-3 lg:h-[26rem] lg:grid-cols-5">
        <div className="flex h-[24rem] min-w-0 flex-col overflow-visible relative rounded-xl border border-border/70 bg-card p-4 text-foreground transition-colors hover:border-border sm:p-5 lg:col-span-3 lg:h-full lg:min-h-0">
          <CategoryStackedChart startDate={startDate} endDate={endDate} />
        </div>

        <div className="grid min-w-0 gap-3 lg:col-span-2 lg:h-full lg:min-h-0 lg:grid-rows-2">
          <div className="flex h-[15rem] min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card p-4 text-foreground transition-colors hover:border-border lg:h-full">
            <PaymentMethodsCard startDate={startDate} endDate={endDate} />
          </div>
          <div className="flex h-[15rem] min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card p-4 text-foreground transition-colors hover:border-border lg:h-full">
            <TopProductsCard startDate={startDate} endDate={endDate} />
          </div>
        </div>
      </div>
    </section>
  );
}
