"use client";

import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAdminMetrics } from "@/hooks/useAdmin";
import { cn } from "@/lib/utils";

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
  const { data: metrics, isLoading, isError, refetch } = useAdminMetrics();

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
          count={5}
          label="Cargando métricas..."
          className="sm:grid-cols-2 xl:grid-cols-5"
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

  const cards = [
    {
      label: "Organizaciones",
      value: metrics.totalOrganizations,
      helper: "en el sistema",
    },
    {
      label: "Activas",
      value: metrics.activeOrganizations,
      helper: "con acceso",
    },
    {
      label: "En prueba",
      value: metrics.trialOrganizations,
      helper: "en periodo trial",
    },
    {
      label: "Suspendidas",
      value: metrics.suspendedOrganizations,
      helper: "sin acceso",
    },
    {
      label: "Usuarios",
      value: metrics.totalUsers,
      helper: "en todas las organizaciones",
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={String(card.value)}
            helper={card.helper}
          />
        ))}
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Organizaciones por plan</h2>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {metrics.totalOrganizations}
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
                const share =
                  metrics.totalOrganizations > 0
                    ? Math.round((count / metrics.totalOrganizations) * 100)
                    : 0;

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
                        {share}%
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
  );
}
