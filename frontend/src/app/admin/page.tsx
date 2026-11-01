"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAdminMetrics, useOrganizations } from "@/hooks/useAdmin";
import { cn } from "@/lib/utils";
import { buildAttentionItems } from "./attention";

const planLabels: Record<string, string> = {
  BASIC: "Básico",
  PRO: "Pro",
};

const planDots: Record<string, string> = {
  BASIC: "bg-slate-400",
  PRO: "bg-primary",
};

// Deterministic reading order: the commercial plan first, then the entry plan,
// then anything the billing module adds later.
const planOrder = ["PRO", "BASIC"];

export default function AdminPage() {
  const router = useRouter();
  const {
    data: metrics,
    isLoading,
    isError,
    refetch,
  } = useAdminMetrics();
  const {
    data: organizations,
    isLoading: organizationsLoading,
    isError: organizationsError,
  } = useOrganizations();

  const attention = useMemo(
    () => buildAttentionItems(organizations ?? []),
    [organizations],
  );

  const header = (
    <PageHeader
      title="Panel"
      subtitle="Organizaciones y usuarios del sistema"
      actions={
        <Button onClick={() => router.push("/admin/organizations")}>
          Gestionar organizaciones
        </Button>
      }
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {header}
        <CardSkeleton
          count={6}
          label="Cargando métricas..."
          className="sm:grid-cols-2 lg:grid-cols-3"
        />
      </div>
    );
  }

  if (isError || !metrics) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState
          message="No se pudieron cargar las métricas del sistema."
          retryLabel="Reintentar"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const total = metrics.totalOrganizations;
  const share = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

  const cards: Array<{
    label: string;
    value: number;
    helper: string;
    href?: string;
  }> = [
    {
      label: "Organizaciones",
      value: total,
      helper: `${metrics.newOrganizationsThisMonth} nuevas este mes`,
    },
    {
      label: "Activas",
      value: metrics.activeOrganizations,
      helper: `${share(metrics.activeOrganizations)}% del total`,
      href: "/admin/organizations?status=ACTIVE",
    },
    {
      label: "En prueba",
      value: metrics.trialOrganizations,
      helper: `${metrics.trialExpiringSoon} por vencer · ${metrics.trialExpired} vencidas`,
      href: "/admin/organizations?status=TRIAL",
    },
    {
      label: "En mora",
      value: metrics.pastDueOrganizations,
      helper: `${metrics.billingOverdue} con facturación vencida`,
      href: "/admin/organizations?status=PAST_DUE",
    },
    {
      label: "Suspendidas",
      value: metrics.suspendedOrganizations,
      helper: `${share(metrics.suspendedOrganizations)}% del total`,
      href: "/admin/organizations?status=SUSPENDED",
    },
    {
      label: "Usuarios activos",
      value: metrics.activeUsers,
      helper: `de ${metrics.totalUsers} cuentas`,
    },
  ];

  const plans = Object.entries(metrics.organizationsByPlan ?? {}).sort(([a], [b]) => {
    const indexA = planOrder.indexOf(a);
    const indexB = planOrder.indexOf(b);
    if (indexA !== -1 || indexB !== -1) {
      return (indexA === -1 ? planOrder.length : indexA) - (indexB === -1 ? planOrder.length : indexB);
    }
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-4">
      {header}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) =>
          card.href ? (
            <Link
              key={card.label}
              href={card.href}
              className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <MetricCard
                label={card.label}
                value={String(card.value)}
                helper={card.helper}
              />
            </Link>
          ) : (
            <MetricCard
              key={card.label}
              label={card.label}
              value={String(card.value)}
              helper={card.helper}
            />
          ),
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">Requieren atención</h2>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {attention.length}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {organizationsLoading ? (
              <p className="px-5 py-6 text-xs text-muted-foreground">
                Cargando organizaciones...
              </p>
            ) : organizationsError ? (
              <p className="px-5 py-6 text-xs text-muted-foreground">
                No se pudieron cargar las organizaciones.
              </p>
            ) : attention.length === 0 ? (
              <p className="px-5 py-6 text-xs text-muted-foreground">
                Ninguna organización requiere atención.
              </p>
            ) : (
              <ul>
                {attention.map((item) => (
                  <li key={item.id} className="border-b border-border/50 last:border-b-0">
                    <Link
                      href={`/admin/organizations/${item.id}`}
                      className="flex min-h-11 items-center justify-between gap-3 px-5 py-2 transition-colors duration-150 hover:bg-muted/30"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-foreground">
                          {item.name}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {item.reason}
                        </span>
                      </span>
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">Organizaciones por plan</h2>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {total}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {plans.length === 0 ? (
              <EmptyState
                icon={<Building2 className="h-4 w-4" />}
                title="Sin organizaciones registradas"
                subtitle="Crea la primera organización desde la lista."
              />
            ) : (
              <ul>
                {plans.map(([plan, count]) => {
                  const planShare = total > 0 ? Math.round((count / total) * 100) : 0;

                  return (
                    <li
                      key={plan}
                      className="flex h-9 items-center justify-between gap-3 border-b border-border/50 px-5 text-[13px] last:border-b-0"
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            planDots[plan] ?? "bg-muted-foreground/50",
                          )}
                        />
                        <span className="text-foreground">{planLabels[plan] ?? plan}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                          {planShare}%
                        </span>
                        <span className="w-8 text-right font-mono text-[13px] text-foreground tabular-nums">
                          {count}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
