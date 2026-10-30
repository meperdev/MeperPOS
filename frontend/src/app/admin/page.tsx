"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { useAdminMetrics } from "@/hooks/useAdmin";
import { Building2, Users, AlertTriangle, CheckCircle, Clock, Loader2 } from "lucide-react";

export default function AdminPage() {
  const { data: metrics, isLoading } = useAdminMetrics();

  if (isLoading) {
    return <LoadingState icon={<Loader2 className="h-8 w-8" />} message="Cargando métricas..." />;
  }

  const cards = [
    {
      title: "Total Organizaciones",
      value: metrics?.totalOrganizations ?? 0,
      icon: Building2,
      variant: "default" as const,
    },
    {
      title: "Activas",
      value: metrics?.activeOrganizations ?? 0,
      icon: CheckCircle,
      variant: "success" as const,
    },
    {
      title: "En Trial",
      value: metrics?.trialOrganizations ?? 0,
      icon: Clock,
      variant: "warning" as const,
    },
    {
      title: "Suspendidas",
      value: metrics?.suspendedOrganizations ?? 0,
      icon: AlertTriangle,
      variant: "danger" as const,
    },
    {
      title: "Usuarios Totales",
      value: metrics?.totalUsers ?? 0,
      icon: Users,
      variant: "primary" as const,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        <Button onClick={() => window.location.href = '/admin/organizations'}>
          Gestionar Organizaciones
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.title} className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
              <card.icon className="h-6 w-6 text-primary-text" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
              <p className="text-2xl font-bold text-foreground">{card.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {metrics?.organizationsByPlan && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-foreground">Organizaciones por Plan</h3>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(metrics.organizationsByPlan).map(([plan, count]) => (
                <Badge key={plan} variant="primary">
                  {plan}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
