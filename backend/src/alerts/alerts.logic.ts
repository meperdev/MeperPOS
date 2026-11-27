import { createHash } from 'node:crypto';
import type { OrgRole } from '@prisma/client';
import { effectiveRoles } from '../common/guards/role-hierarchy';
import { formatDateInBogota } from '../common/utils/bogota-date';
import {
  bogotaToday,
  toCalendarDay,
} from '../purchase-orders/purchase-order-status';
import type {
  AlertCategory,
  AlertSeverity,
  AlertSignals,
  AlertVisibility,
  OrgAlert,
} from './alerts.types';

/**
 * The hierarchy `RolesGuard` applies, re-exported: the feed composes several
 * categories in one response and cannot lean on a single `@Roles(...)` clause.
 */
export { effectiveRoles };

/**
 * Who sees what. Billing and plan limits are administrative; stock follows the
 * inventory capability; loans and tasks follow operations. `SUPER_ADMIN` sees
 * every category for the organization it is scoped to.
 */
export function alertVisibility(
  role: OrgRole | 'SUPER_ADMIN',
): AlertVisibility {
  const roles = effectiveRoles(role);
  const administrative = role === 'SUPER_ADMIN' || roles.includes('ADMIN');
  return {
    billing: administrative,
    stock: administrative || roles.includes('INVENTORY_USER'),
    operations:
      administrative ||
      roles.includes('CASHIER') ||
      roles.includes('INVENTORY_USER'),
  };
}

/** Stable fingerprint for a revision field. Order-independent on purpose. */
export function fingerprint(parts: readonly string[]): string {
  return createHash('sha1')
    .update([...parts].sort().join('|'))
    .digest('hex')
    .slice(0, 16);
}

const LIMIT_LABELS: Record<AlertSignals['limits'][number]['type'], string> = {
  users: 'usuarios',
  products: 'productos',
  customers: 'clientes',
  cashRegisters: 'cajas',
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

const plural = (count: number, one: string, many: string): string =>
  count === 1 ? one : many;

/**
 * Whole calendar days in Bogotá from the day of `from` to the day of `to`.
 *
 * Both ends are reduced to the midnight-UTC value of their Bogotá day — the
 * shape `@db.Date` columns carry — so the result ticks at the shop's midnight
 * instead of trailing the current instant by a rounding step.
 */
const bogotaDaysBetween = (from: Date, to: Date): number =>
  (toCalendarDay(formatDateInBogota(to)).getTime() -
    bogotaToday(from).getTime()) /
  86_400_000;

function limitAlerts(limits: AlertSignals['limits']): OrgAlert[] {
  const alerts: OrgAlert[] = [];
  for (const limit of limits) {
    // `-1` is unlimited. The guard blocks the next creation at
    // `current >= limit`, so at-capacity is not the same thing as over it.
    if (limit.limit < 0) continue;
    const label = LIMIT_LABELS[limit.type];
    const revision = fingerprint([
      limit.type,
      String(limit.current),
      String(limit.limit),
    ]);
    if (limit.current > limit.limit) {
      alerts.push({
        id: `limits:${limit.type}:exceeded`,
        category: 'limits',
        severity: 'critical',
        title: `Límite de ${label} excedido`,
        detail: `Usas ${limit.current} de ${limit.limit}. Actualiza tu plan.`,
        href: '/settings/billing',
        revision,
      });
    } else if (limit.current === limit.limit) {
      alerts.push({
        id: `limits:${limit.type}:at-limit`,
        category: 'limits',
        severity: 'warning',
        title: `Alcanzaste el límite de ${label}`,
        detail: `Usas ${limit.current} de ${limit.limit}. Para agregar más, actualiza tu plan.`,
        href: '/settings/billing',
        revision,
      });
    } else if (limit.current >= limit.warningAt) {
      alerts.push({
        id: `limits:${limit.type}:near`,
        category: 'limits',
        severity: 'warning',
        title: `Cerca del límite de ${label}`,
        detail: `Usas ${limit.current} de ${limit.limit}.`,
        href: '/settings/billing',
        revision,
      });
    }
  }
  return alerts;
}

/**
 * Builds the organization's alert feed from signals the app already owns.
 * Nothing is invented: an alert exists only while its condition is true, and its
 * revision changes only when the underlying facts do.
 */
export function buildAlerts(signals: AlertSignals): OrgAlert[] {
  const { role, now, organization } = signals;
  const visible = alertVisibility(role);
  const alerts: OrgAlert[] = [];

  if (organization && visible.billing) {
    const trialEndsAt = organization.trialEndsAt;
    if (organization.status === 'SUSPENDED') {
      alerts.push({
        id: 'billing:suspended',
        category: 'billing',
        severity: 'critical',
        title: 'Organización suspendida',
        detail: 'Solo puedes consultar datos. Contacta al administrador.',
        href: '/settings/billing',
        revision: fingerprint(['SUSPENDED']),
      });
    } else if (organization.status === 'PAST_DUE') {
      alerts.push({
        id: 'billing:past-due',
        category: 'billing',
        severity: 'critical',
        title: 'Suscripción vencida',
        detail: 'Regulariza el pago para evitar la suspensión.',
        href: '/settings/billing',
        revision: fingerprint(['PAST_DUE']),
      });
    } else if (organization.status === 'TRIAL' && trialEndsAt) {
      const daysLeft = bogotaDaysBetween(now, trialEndsAt);
      alerts.push({
        id: 'billing:trial',
        category: 'billing',
        severity: daysLeft <= 3 ? 'warning' : 'info',
        title:
          daysLeft < 0
            ? 'Tu prueba terminó'
            : daysLeft === 0
              ? 'Tu prueba termina hoy'
              : `Tu prueba termina en ${daysLeft} ${plural(daysLeft, 'día', 'días')}`,
        detail: 'Actualiza a PRO para desbloquear todos los límites.',
        href: '/settings/billing',
        revision: fingerprint([
          'TRIAL',
          trialEndsAt.toISOString(),
          String(daysLeft),
        ]),
      });
    }
  }

  if (visible.billing) {
    alerts.push(...limitAlerts(signals.limits));
  }

  if (visible.stock && signals.lowStock.length > 0) {
    const items = signals.lowStock;
    const depleted = items.filter((item) => item.stock === 0).length;
    alerts.push({
      // The id names the condition, not the event: a product crossing to zero
      // flips severity and title but must not look like a new alert, so the
      // depleted count rides in the revision instead.
      id: 'stock:low',
      category: 'stock',
      severity: depleted > 0 ? 'critical' : 'warning',
      title:
        depleted > 0
          ? `${depleted} ${plural(depleted, 'producto', 'productos')} ${plural(depleted, 'agotado', 'agotados')}`
          : 'Stock bajo',
      detail: `${items.length} ${plural(items.length, 'producto', 'productos')} por debajo del mínimo.`,
      href: '/inventory?filter=lowStock',
      revision: fingerprint([
        ...items.map((item) => `${item.id}:${item.stock}:${item.minStock}`),
        `depleted:${depleted}`,
      ]),
    });
  }

  if (visible.operations) {
    if (signals.overdueLoans.length > 0) {
      const loans = signals.overdueLoans;
      alerts.push({
        id: 'loans:overdue',
        category: 'loans',
        severity: 'warning',
        title: `${loans.length} ${plural(loans.length, 'préstamo vencido', 'préstamos vencidos')}`,
        detail: 'Revisa los saldos pendientes.',
        href: '/loans',
        revision: fingerprint(
          loans.map((loan) => `${loan.id}:${loan.dueAt.toISOString()}`),
        ),
      });
    }

    if (signals.overdueTasks.length > 0) {
      const tasks = signals.overdueTasks;
      alerts.push({
        id: 'tasks:overdue',
        category: 'tasks',
        severity: 'warning',
        title: `${tasks.length} ${plural(tasks.length, 'tarea vencida', 'tareas vencidas')}`,
        detail: 'Tienen fecha límite pasada y siguen abiertas.',
        href: '/tasks',
        revision: fingerprint(tasks.map((task) => task.id)),
      });
    }
  }

  return alerts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category],
  );
}
