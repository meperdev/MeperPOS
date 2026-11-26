"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useLocations } from "@/hooks/useLocations";
import { useDashboard } from "@/hooks/useReports";
import { useAuth } from "@/contexts/AuthContext";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { SiteFilter } from "@/components/reports/SiteFilter";
import { TodayStats } from "@/components/dashboard/TodayStats";
import { AlertPanels } from "@/components/dashboard/AlertPanels";
import { RevenueSection } from "@/components/dashboard/RevenueSection";
import { RecentSalesCard } from "@/components/dashboard/RecentSalesCard";

export default function DashboardPage() {
  // The site every sales figure below is read for; empty is the whole
  // organization. The directory already applies the access rule.
  const [siteId, setSiteId] = useState("");
  const sites = useLocations();
  // "Todas las sedes" is the selector's empty value; the queries take the
  // absence of a site, never an empty id.
  const selectedSiteId = siteId || undefined;
  const { isLoading } = useDashboard(undefined, undefined, selectedSiteId);
  const { user } = useAuth();

  return (
    <DashboardLayout>
      <div className="space-y-4 overflow-x-hidden">
        {/* Page header. The site selector sits with it because every panel below
            reads its sales figures for the same site, and it stays mounted while
            another site loads, so the reader never loses the control. */}
        <PageHeader
          title={`Bienvenido, ${user?.name?.split(" ")[0] ?? ""}`}
          actions={
            <SiteFilter
              sites={sites.data ?? []}
              value={siteId}
              onChange={setSiteId}
              className="w-full sm:w-44"
            />
          }
        />

        {isLoading ? (
          // The panel's own shape, not a spinner: the KPI row, the revenue
          // block and the latest-sales list, so the page does not jump into
          // place.
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
        ) : (
          <>
            {/* Panel metrics: today's KPI row, the low-stock alert strip and the
                all-time totals card */}
            <TodayStats siteId={selectedSiteId} />

            {/* Revenue piece — shared range selector over the category chart,
                payment-method donut and top-products list */}
            <RevenueSection siteId={selectedSiteId} />

            {/* Compact peek at the latest sales */}
            <RecentSalesCard siteId={selectedSiteId} />

            {/* Operational alert panels (capped, so the page never grows without bound) */}
            <AlertPanels />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
