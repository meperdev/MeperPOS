"use client";

import { useAuth } from "@/contexts/AuthContext";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, memo } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { AppHeader } from "@/components/layout/AppHeader";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AppShellSkeleton } from "@/components/layout/AppShellSkeleton";
import { PlanLimitBanner } from "@/components/billing/PlanLimitBanner";
import { ConnectionStatus } from "@/components/pwa/ConnectionStatus";
import { UpdateAvailableBanner } from "@/components/pwa/UpdateAvailableBanner";
import { hasAnyRole, type AppRole } from "@/lib/auth";
import { useSidebar } from "@/contexts/SidebarContext";
import { cn } from "@/lib/utils";

type UserRole = AppRole;

// S5: payroll and the employee directory belong to owners and administrators
// only. They are checked by identity before the shared route map, because the
// inherited role list would let an ADMIN-scoped SUPER_ADMIN read tenant payroll.
const ownerAdminOnlyPrefixes = ["/employees", "/payroll"];

const routeRoleMap: Array<{ prefix: string; roles: UserRole[] }> = [
  { prefix: "/dashboard", roles: ["ADMIN", "INVENTORY_USER"] },
  { prefix: "/pos", roles: ["ADMIN", "CASHIER"] },
  { prefix: "/inventory", roles: ["ADMIN", "CASHIER", "INVENTORY_USER"] },
  { prefix: "/suppliers", roles: ["ADMIN", "INVENTORY_USER"] },
  { prefix: "/purchase-orders", roles: ["ADMIN", "INVENTORY_USER"] },
  { prefix: "/sales", roles: ["ADMIN", "CASHIER"] },
  { prefix: "/expenses", roles: ["ADMIN"] },
  { prefix: "/customers", roles: ["ADMIN", "CASHIER"] },
  { prefix: "/loans", roles: ["ADMIN", "CASHIER"] },
  { prefix: "/reports", roles: ["ADMIN"] },
  { prefix: "/users", roles: ["ADMIN"] },
  { prefix: "/tasks", roles: ["ADMIN", "CASHIER", "INVENTORY_USER"] },
  { prefix: "/alerts", roles: ["ADMIN", "INVENTORY_USER"] },
  { prefix: "/categories", roles: ["ADMIN", "INVENTORY_USER"] },
  { prefix: "/settings", roles: ["ADMIN"] },
  { prefix: "/profile", roles: ["ADMIN", "CASHIER", "INVENTORY_USER"] },
];

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export const DashboardLayout = memo(function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const { isAuthenticated, loading, user, organization } = useAuth();
  const { isCollapsed } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();

  const userRole = user?.role;
  const organizationStatus = organization?.status;

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isAuthenticated, loading, router]);

  useEffect(() => {
    if (loading || !isAuthenticated || !userRole) return;

    if (ownerAdminOnlyPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      if (userRole !== "OWNER" && userRole !== "ADMIN") {
        router.replace(userRole === "CASHIER" ? "/pos" : "/dashboard");
      }
      return;
    }

    if (userRole === "SUPER_ADMIN") {
      return;
    }

    const routeConfig = routeRoleMap.find(
      (route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)
    );

    if (!routeConfig) return;

    if (!hasAnyRole(userRole, routeConfig.roles)) {
      router.replace(userRole === "CASHIER" ? "/pos" : "/dashboard");
    }
  }, [isAuthenticated, loading, pathname, router, userRole]);

  // The session cookie is exchanged for an access token after hydration. The
  // shell stays mounted through that window so the rail keeps its geometry and
  // the page never blanks; only the authenticated content waits.
  if (!loading && !isAuthenticated) return null;

  return (
    <div className="min-h-dvh bg-background" data-org-status={organizationStatus}>
      {loading ? (
        <AppShellSkeleton isCollapsed={isCollapsed} />
      ) : (
        <>
          <Sidebar />
          <MobileTabBar />
          {/* The desktop bar sits above the content column and right of the
              rail; below `lg` the mobile top bar carries the same three
              surfaces. The palette is mounted once for the whole shell. */}
          <AppHeader isCollapsed={isCollapsed} />
          <CommandPalette />
          <main
            className={cn(
              // Full-height flex column: a page root that grows to fill it can pin its paginator to the bottom.
              "flex min-h-dvh flex-col",
              // At lg the sticky header owns the top `--app-header-height`, so the
              // column fills what the bar leaves instead of adding a second
              // viewport's worth of scroll under it.
              "lg:min-h-[calc(100dvh-var(--app-header-height))]",
              // Derived, not magic: the mobile header is `--mobile-header`, the gap
              // below it is `--mobile-header-gap`, the bottom edge belongs to the
              // tab bar (`--mobile-tabbar` plus its inset) and the notch insets are
              // added on top. Changing a bar moves this column with it. `lg:` keeps
              // the desktop column as it was; physical insets are zero there.
              "pt-[calc(var(--mobile-header)+var(--mobile-header-gap)+var(--safe-top))] pb-[calc(var(--mobile-tabbar)+var(--safe-bottom)+var(--mobile-content-bottom-gap))]",
              "pl-[calc(1rem+var(--safe-left))] pr-[calc(1rem+var(--safe-right))]",
              // The desktop vertical gutter is published as a token because it is
              // the only number a viewport-fitting page (the POS) has to subtract;
              // it is declared here, next to the padding that applies it, so the
              // two can never drift.
              "[--app-content-padding-y:2rem]",
              "lg:px-8 lg:pb-[var(--app-content-padding-y)] lg:pt-[var(--app-content-padding-y)]",
              "transition-[margin] duration-300 ease-in-out",
              isCollapsed ? "lg:ml-[72px]" : "lg:ml-[256px]"
            )}
          >
            <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col">
              <UpdateAvailableBanner />
              <ConnectionStatus />
              <PlanLimitBanner />
              {/* A section's content settles in on arrival. Keyed by pathname, so
                  a query-string change (filters, pagination) keeps the same
                  subtree mounted and does not replay the animation, while the
                  shell around it never remounts. No exit animation: navigation
                  is never delayed. The class carries no resting transform, so
                  fixed descendants stay anchored to the viewport. */}
              <div
                key={pathname}
                data-page-enter=""
                className="flex flex-1 flex-col animate-page-enter"
              >
                {children}
              </div>
            </div>
          </main>
        </>
      )}
    </div>
  );
});
