import { Injectable } from '@nestjs/common';
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
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { alertVisibility, buildAlerts } from './alerts.logic';
import type { OrgAlert } from './alerts.types';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitService,
  ) {}

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

    const [limits, lowStock, overdueLoans, overdueTasks] = await Promise.all([
      visible.billing
        ? Promise.all(
            LIMIT_TYPES.map((type) =>
              this.planLimits.getLimitStatus(type, organizationId),
            ),
          )
        : Promise.resolve<PlanLimitResult[]>([]),
      visible.stock ? this.lowStock(organizationId) : Promise.resolve([]),
      visible.operations
        ? this.overdueLoans(organizationId, now)
        : Promise.resolve([]),
      visible.operations
        ? this.overdueTasks(organizationId, now)
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
   * The same rule as every other stock surface (tracked, active merchandise at or
   * below its minimum), evaluated in the database through a field reference so
   * the feed never loads the catalog to count it.
   */
  private lowStock(
    organizationId: string,
  ): Promise<Array<{ id: string; stock: number; minStock: number }>> {
    return this.prisma.product.findMany({
      where: {
        organizationId,
        active: true,
        type: ProductType.PRODUCT,
        tracksStock: true,
        stock: { lte: this.prisma.product.fields.minStock },
      } as Prisma.ProductWhereInput,
      select: { id: true, stock: true, minStock: true },
    });
  }

  private overdueLoans(
    organizationId: string,
    now: Date,
  ): Promise<Array<{ id: string; dueAt: Date }>> {
    return this.prisma.moneyLoan.findMany({
      where: {
        organizationId,
        status: MoneyLoanStatus.OPEN,
        dueAt: { lt: now },
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
