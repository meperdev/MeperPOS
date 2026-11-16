"use client";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useDashboard } from "@/hooks/useReports";
import { useAuth } from "@/contexts/AuthContext";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { TodayStats } from "@/components/dashboard/TodayStats";
import { AlertPanels } from "@/components/dashboard/AlertPanels";
import { RevenueSection } from "@/components/dashboard/RevenueSection";
import { RecentSalesCard } from "@/components/dashboard/RecentSalesCard";

export default function DashboardPage() {
  const { isLoading } = useDashboard();
  const { user } = useAuth();

  if (isLoading) {
    return (
      <DashboardLayout>
        {/* The panel's own shape, not a spinner: the KPI row, the revenue block
            and the latest-sales list, so the page does not jump into place. */}
        <div aria-busy="true" className="space-y-4 overflow-x-hidden">
          <CardSkeleton
            count={4}
            label="Cargando panel…"
            className="grid-cols-2 xl:grid-cols-4"
            cardClassName="min-h-[92px]"
          />
          <CardSkeleton
            count={1}
            label=""
            className="grid-cols-1"
            cardClassName="min-h-[240px]"
          />
          <TableSkeleton rows={4} columns={3} label="" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 overflow-x-hidden">
        {/* Page header */}
        <PageHeader title={`Bienvenido, ${user?.name?.split(" ")[0] ?? ""}`} />

        {/* Panel metrics: today's KPI row, the low-stock alert strip and the
            all-time totals card */}
        <TodayStats />

        {/* Revenue piece — shared range selector over the category chart,
            payment-method donut and top-products list */}
        <RevenueSection />

        {/* Compact peek at the latest sales */}
        <RecentSalesCard />

        {/* Operational alert panels (capped, so the page never grows without bound) */}
        <AlertPanels />
      </div>
    </DashboardLayout>
  );
}
