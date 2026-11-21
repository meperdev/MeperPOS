import type { PlanType } from '@prisma/client';

export interface PlanLimits {
  maxUsers: number;
  maxProducts: number;
  maxCustomers: number;
  maxCashRegisters: number;
  hasForceClose: boolean;
}

/**
 * One entry per `PlanType` in the Postgres enum. The `Record` is the guard: a
 * plan added to the database and not priced here fails the TypeScript build
 * instead of reaching the `BadRequestException` in `PlanLimitService`.
 */
export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  BASIC: {
    maxUsers: 3,
    maxProducts: 100,
    maxCustomers: 50,
    maxCashRegisters: 1,
    hasForceClose: false,
  },
  PRO: {
    maxUsers: -1,
    maxProducts: -1,
    maxCustomers: -1,
    maxCashRegisters: -1,
    hasForceClose: true,
  },
};

export type { PlanType };
export type LimitType = 'users' | 'products' | 'customers' | 'cashRegisters';

export interface PlanLimitResult {
  type: LimitType;
  current: number;
  limit: number;
  exceeded: boolean;
  warningAt: number; // 80%
}
