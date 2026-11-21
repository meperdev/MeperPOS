import { Injectable, Logger } from '@nestjs/common';
import {
  MoneyLoanStatus,
  Prisma,
  ProductType,
  TaskStatus,
} from '@prisma/client';
import type {
  LimitType,
  PlanLimitResult,
} from '../plan-limits/plan-limits.constants';
import { PlanLimitService } from '../plan-limits/plan-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { bogotaToday } from '../purchase-orders/purchase-order-status';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { alertVisibility, buildAlerts } from './alerts.logic';
import type {
  OrgAlert,
  StockAlertEventKind,
  StockAlertHistoryItem,
  StockAlertHistoryPage,
} from './alerts.types';
import { lowStockProductWhere } from './low-stock.where';

const LIMIT_TYPES: readonly LimitType[] = [
  'users',
  'products',
  'customers',
  'cashRegisters',
];

/**
 * The single authority for the alert feed.
 *
 * The client used to derive every alert from four separate queries and a role
 * check, and dropped the whole list whenever its session carried no organization
 * object. Here the organization comes from the token, visibility is decided in
 * one place, and every alert carries the fingerprint of the facts behind it, so
 * the bell can tell "still the same low-stock condition" apart from "the set of
 * low products changed today".
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitService,
  ) {}

  /**
   * Runs one signal query and falls back to an empty signal on failure.
   *
   * Containment is per source on purpose: the feed is a convenience surface, and
   * losing every category because one of four queries timed out is worse than
   * serving the categories that answered. Only the source name and the error type
   * are logged — never a tenant, a count or a query.
   */
  private async settle<T>(
    source: 'limits' | 'stock' | 'loans' | 'tasks',
    fallback: T,
    load: () => Promise<T>,
  ): Promise<T> {
    try {
      return await load();
    } catch (error) {
      this.logger.warn({
        event: 'alerts_signal_failed',
        source,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return fallback;
    }
  }

  /**
   * Returns the caller's alerts. An account without an organization scope (a
   * super administrator before choosing one) has no feed rather than a partial
   * one, because every signal here is tenant data.
   */
  async list(user: RequestUser): Promise<OrgAlert[]> {
    const organizationId = user.organizationId;
    if (!organizationId) return [];

    const visible = alertVisibility(user.role);
    const now = new Date();

    // The organization row is the tenant itself: without it there is no feed to
    // build, and no signal query should run against a scope that does not exist.
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true, trialEndsAt: true },
    });
    if (!organization) return [];

    // Each source is contained on its own: one failing dependency must drop only
    // its category, never the whole feed. The previous client derivation degraded
    // per source, and a bell that goes empty on a transient loans timeout is
    // indistinguishable from a healthy "nothing to report".
    const [limits, lowStock, overdueLoans, overdueTasks] = await Promise.all([
      visible.billing
        ? Promise.all(
            LIMIT_TYPES.map((type) =>
              this.settle<PlanLimitResult | null>('limits', null, () =>
                this.planLimits.getLimitStatus(type, organizationId),
              ),
            ),
          ).then((rows) =>
            rows.filter((row): row is PlanLimitResult => row !== null),
          )
        : Promise.resolve<PlanLimitResult[]>([]),
      visible.stock
        ? this.settle('stock', [], () => this.lowStock(organizationId))
        : Promise.resolve([]),
      visible.operations
        ? this.settle('loans', [], () => this.overdueLoans(organizationId, now))
        : Promise.resolve([]),
      visible.operations
        ? this.settle('tasks', [], () => this.overdueTasks(organizationId, now))
        : Promise.resolve([]),
    ]);

    return buildAlerts({
      role: user.role,
      now,
      organization,
      limits,
      lowStock,
      overdueLoans,
      overdueTasks,
    });
  }

  /**
   * The notification history for the caller's organization, newest first.
   *
   * Rows are append-only events written by the scan, so a product that crossed its
   * minimum several times keeps every episode instead of only the last one.
   */
  async history(
    user: RequestUser,
    page = 1,
    limit = 20,
    kind?: StockAlertEventKind,
  ): Promise<StockAlertHistoryPage> {
    const organizationId = user.organizationId;
    if (!organizationId) {
      return { data: [], meta: { total: 0, page: 1, limit, totalPages: 0 } };
    }

    const safePage = Math.max(1, Math.trunc(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 20));
    const where = { organizationId, ...(kind ? { kind } : {}) };

    const [rows, total] = await Promise.all([
      this.prisma.productStockAlertEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: {
          id: true,
          episode: true,
          kind: true,
          failureReason: true,
          createdAt: true,
          product: { select: { id: true, name: true, sku: true } },
        },
      }),
      this.prisma.productStockAlertEvent.count({ where }),
    ]);

    return {
      data: rows as StockAlertHistoryItem[],
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * The same rule as every other stock surface (tracked, active merchandise at or
   * below its minimum), evaluated in the database through a field reference so
   * the feed never loads the catalog to count it.
   */
  private lowStock(
    organizationId: string,
  ): Promise<Array<{ id: string; stock: number; minStock: number }>> {
    return this.prisma.product.findMany({
      where: lowStockProductWhere(
        organizationId,
        this.prisma.product.fields.minStock,
      ),
      select: { id: true, stock: true, minStock: true },
    });
  }

  /**
   * Loans still open whose due day is behind today's business day.
   *
   * `dueAt` is a `@db.Date` column, so Prisma stores the calendar day at
   * midnight UTC and compares that raw value. Handing it the current instant
   * turned a loan due today into an overdue one from 19:00 in Bogotá — five
   * hours before its own day starts — so the cutoff is midnight UTC of today's
   * Bogotá day, the same day boundary the loans page reads.
   */
  private overdueLoans(
    organizationId: string,
    now: Date,
  ): Promise<Array<{ id: string; dueAt: Date }>> {
    return this.prisma.moneyLoan.findMany({
      where: {
        organizationId,
        status: MoneyLoanStatus.OPEN,
        dueAt: { lt: bogotaToday(now) },
      },
      select: { id: true, dueAt: true },
    }) as Promise<Array<{ id: string; dueAt: Date }>>;
  }

  private overdueTasks(
    organizationId: string,
    now: Date,
  ): Promise<Array<{ id: string }>> {
    return this.prisma.task.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
        dueDate: { lt: now },
      },
      select: { id: true },
    });
  }
}
