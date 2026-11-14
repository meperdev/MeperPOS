"use client";

import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hasAnyRole } from "@/lib/auth";
import { useLoans } from "@/hooks/useLoans";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useLowStockProducts } from "@/hooks/useProducts";
import { useTasks } from "@/hooks/useTasks";
import { useNow } from "@/hooks/useNow";
import type { PlanLimit } from "@/types";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertCategory = "billing" | "limits" | "stock" | "loans" | "tasks";

export interface AppAlert {
  /** Stable identity of the condition, used for the read/unread ledger. */
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string;
}

const LIMIT_LABELS: Record<PlanLimit["type"], string> = {
  users: "usuarios",
  products: "productos",
  customers: "clientes",
  cashRegisters: "cajas",
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const CATEGORY_RANK: Record<AlertCategory, number> = {
  billing: 0,
  limits: 1,
  stock: 2,
  loans: 3,
  tasks: 4,
};

/**
 * Persistent alerts derived from signals the app already owns. Nothing is
 * invented: an alert exists only while its condition is true.
 */
export function useAlerts(): AppAlert[] {
  const { user, organization } = useAuth();
  const role = user?.role;
  const now = useNow();

  const canSeeBilling = hasAnyRole(role, ["ADMIN"]);
  const canSeeStock = hasAnyRole(role, ["ADMIN", "INVENTORY_USER"]);
  const canSeeOperations = hasAnyRole(role, [
    "ADMIN",
    "CASHIER",
    "INVENTORY_USER",
  ]);

  const plans = usePlanLimits({ enabled: canSeeBilling });
  const lowStock = useLowStockProducts({ enabled: canSeeStock });
  const loans = useLoans({ page: 1, limit: 100 }, { enabled: canSeeOperations });
  const tasks = useTasks(undefined, { enabled: canSeeOperations });

  return useMemo(() => {
    const alerts: AppAlert[] = [];
    if (!organization) return alerts;

    if (canSeeBilling) {
      if (organization.status === "SUSPENDED") {
        alerts.push({
          id: "billing:suspended",
          category: "billing",
          severity: "critical",
          title: "Organización suspendida",
          detail: "Solo puedes consultar datos. Contacta al administrador.",
          href: "/settings/billing",
        });
      } else if (organization.status === "PAST_DUE") {
        alerts.push({
          id: "billing:past-due",
          category: "billing",
          severity: "critical",
          title: "Suscripción vencida",
          detail: "Regulariza el pago para evitar la suspensión.",
          href: "/settings/billing",
        });
      } else if (organization.status === "TRIAL" && organization.trialEndsAt) {
        const daysLeft = Math.ceil(
          (new Date(organization.trialEndsAt).getTime() - now) / 86_400_000,
        );
        alerts.push({
          id: "billing:trial",
          category: "billing",
          severity: daysLeft <= 3 ? "warning" : "info",
          title:
            daysLeft <= 0
              ? "Tu prueba terminó"
              : `Tu prueba termina en ${daysLeft} día${daysLeft === 1 ? "" : "s"}`,
          detail: "Actualiza a PRO para desbloquear todos los límites.",
          href: "/settings/billing",
        });
      }

      for (const limit of plans.data?.limits ?? []) {
        // `-1` is unlimited. The backend reports `exceeded` from `current >= limit`
        // because the guard must block the next creation, so at-capacity is not
        // the same thing as over the limit: only `current > limit` is a violation.
        if (limit.limit < 0) continue;
        const label = LIMIT_LABELS[limit.type];
        if (limit.current > limit.limit) {
          alerts.push({
            id: `limits:${limit.type}:exceeded`,
            category: "limits",
            severity: "critical",
            title: `Límite de ${label} excedido`,
            detail: `Usas ${limit.current} de ${limit.limit}. Actualiza tu plan.`,
            href: "/settings/billing",
          });
        } else if (limit.current === limit.limit) {
          alerts.push({
            id: `limits:${limit.type}:at-limit`,
            category: "limits",
            severity: "warning",
            title: `Alcanzaste el límite de ${label}`,
            detail: `Usas ${limit.current} de ${limit.limit}. Para agregar más, actualiza tu plan.`,
            href: "/settings/billing",
          });
        } else if (limit.current >= limit.warningAt) {
          alerts.push({
            id: `limits:${limit.type}:near`,
            category: "limits",
            severity: "warning",
            title: `Cerca del límite de ${label}`,
            detail: `Usas ${limit.current} de ${limit.limit}.`,
            href: "/settings/billing",
          });
        }
      }
    }

    if (canSeeStock) {
      const items = lowStock.data ?? [];
      const depleted = items.filter((item) => item.stock === 0).length;
      if (items.length > 0) {
        alerts.push({
          id: depleted > 0 ? "stock:depleted" : "stock:low",
          category: "stock",
          severity: depleted > 0 ? "critical" : "warning",
          title:
            depleted > 0
              ? `${depleted} producto${depleted === 1 ? "" : "s"} agotado${depleted === 1 ? "" : "s"}`
              : "Stock bajo",
          detail: `${items.length} producto${items.length === 1 ? "" : "s"} por debajo del mínimo.`,
          href: "/inventory?filter=lowStock",
        });
      }
    }

    if (canSeeOperations) {
      const overdueLoans = (loans.data?.data ?? []).filter(
        (loan) =>
          loan.status === "OPEN" &&
          loan.dueAt !== null &&
          new Date(loan.dueAt).getTime() < now,
      );
      if (overdueLoans.length > 0) {
        alerts.push({
          id: "loans:overdue",
          category: "loans",
          severity: "warning",
          title: `${overdueLoans.length} préstamo${overdueLoans.length === 1 ? "" : "s"} vencido${overdueLoans.length === 1 ? "" : "s"}`,
          detail: "Revisa los saldos pendientes.",
          href: "/loans",
        });
      }

      const overdueTasks = (tasks.data?.tasks ?? []).filter(
        (task) =>
          task.dueDate !== null &&
          task.dueDate !== undefined &&
          task.status !== "COMPLETED" &&
          task.status !== "CANCELLED" &&
          new Date(task.dueDate).getTime() < now,
      );
      if (overdueTasks.length > 0) {
        alerts.push({
          id: "tasks:overdue",
          category: "tasks",
          severity: "warning",
          title: `${overdueTasks.length} tarea${overdueTasks.length === 1 ? "" : "s"} vencida${overdueTasks.length === 1 ? "" : "s"}`,
          detail: "Tienen fecha límite pasada y siguen abiertas.",
          href: "/tasks",
        });
      }
    }

    return alerts.sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category],
    );
  }, [
    canSeeBilling,
    canSeeOperations,
    canSeeStock,
    loans.data,
    lowStock.data,
    now,
    organization,
    plans.data,
    tasks.data,
  ]);
}
