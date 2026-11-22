import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PLAN_LIMITS,
  LimitType,
  PlanLimitResult,
} from './plan-limits.constants';

interface CacheEntry {
  value: number;
  expiresAt: number;
}

@Injectable()
export class PlanLimitService {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 60_000; // 60 seconds

  constructor(private prisma: PrismaService) {}

  async getLimitStatus(
    type: LimitType,
    organizationId: string,
  ): Promise<PlanLimitResult> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });

    if (!org) {
      return {
        type,
        current: 0,
        limit: 0,
        exceeded: true,
        warningAt: 0,
      };
    }

    const plan = org.plan;
    if (!['BASIC', 'PRO'].includes(plan as string)) {
      throw new BadRequestException(`Invalid plan: ${plan}`);
    }
    const limit = PLAN_LIMITS[plan]?.[`max${this.capitalize(type)}`] ?? -1;

    const current = await this.count(type, organizationId);

    // -1 means unlimited
    if (limit === -1) {
      return {
        type,
        current,
        limit: -1,
        exceeded: false,
        warningAt: Number.POSITIVE_INFINITY,
      };
    }

    const warningAt = Math.floor(limit * 0.8);

    return {
      type,
      current,
      limit,
      exceeded: current >= limit,
      warningAt,
    };
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  async count(type: LimitType, organizationId: string): Promise<number> {
    this.cleanupExpiredCache();
    const cacheKey = `${type}:${organizationId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let value = 0;

    switch (type) {
      case 'users':
        value = await this.prisma.organizationUser.count({
          where: { organizationId },
        });
        break;
      case 'products':
        value = await this.prisma.product.count({
          where: { organizationId, active: true },
        });
        break;
      case 'customers':
        value = await this.prisma.customer.count({
          where: { organizationId, active: true },
        });
        break;
      case 'cashRegisters':
        value = await this.prisma.cashRegister.count({
          where: { organizationId, active: true },
        });
        break;
    }

    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.TTL_MS,
    });

    return value;
  }

  async checkLimit(
    type: LimitType,
    organizationId: string,
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    const status = await this.getLimitStatus(type, organizationId);
    return {
      allowed: !status.exceeded,
      current: status.current,
      limit: status.limit,
    };
  }

  invalidateCache(type: LimitType, organizationId: string): void {
    const cacheKey = `${type}:${organizationId}`;
    this.cache.delete(cacheKey);
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
