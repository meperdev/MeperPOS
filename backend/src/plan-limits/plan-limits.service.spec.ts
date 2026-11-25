import { PlanType } from '@prisma/client';
import { PlanLimitService } from './plan-limits.service';
import { PLAN_LIMITS } from './plan-limits.constants';

describe('PlanLimitService', () => {
  let service: PlanLimitService;

  const prismaMock = {
    organization: {
      findUnique: jest.fn(),
    },
    organizationUser: {
      count: jest.fn(),
    },
    product: {
      count: jest.fn(),
    },
    customer: {
      count: jest.fn(),
    },
    cashRegister: {
      count: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    service = new PlanLimitService(prismaMock as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('PLAN_LIMITS constants', () => {
    it('BASIC plan has correct limits', () => {
      expect(PLAN_LIMITS.BASIC.maxUsers).toBe(3);
      expect(PLAN_LIMITS.BASIC.maxProducts).toBe(100);
      expect(PLAN_LIMITS.BASIC.maxCustomers).toBe(50);
      expect(PLAN_LIMITS.BASIC.maxCashRegisters).toBe(1);
      expect(PLAN_LIMITS.BASIC.hasForceClose).toBe(false);
    });

    it('PRO plan has unlimited limits', () => {
      expect(PLAN_LIMITS.PRO.maxUsers).toBe(-1);
      expect(PLAN_LIMITS.PRO.maxProducts).toBe(-1);
      expect(PLAN_LIMITS.PRO.maxCustomers).toBe(-1);
      expect(PLAN_LIMITS.PRO.maxCashRegisters).toBe(-1);
      expect(PLAN_LIMITS.PRO.hasForceClose).toBe(true);
    });

    // The table is typed `Record<PlanType, PlanLimits>`, so a plan missing here
    // is a compile error; this pins the runtime side of the same promise.
    it('prices every PlanType in the database enum', () => {
      expect(Object.keys(PLAN_LIMITS).sort()).toEqual(
        Object.values(PlanType).sort(),
      );
    });

    it('keeps the same shape for every plan', () => {
      const shape = Object.keys(PLAN_LIMITS.BASIC).sort();
      for (const plan of Object.values(PlanType)) {
        expect(Object.keys(PLAN_LIMITS[plan]).sort()).toEqual(shape);
      }
    });
  });

  describe('getLimitStatus', () => {
    it('returns exceeded=false for PRO plan (unlimited)', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ plan: 'PRO' });
      prismaMock.organizationUser.count.mockResolvedValue(999);

      const result = await service.getLimitStatus('users', 'org-1');

      expect(result.exceeded).toBe(false);
      expect(result.limit).toBe(-1);
      expect(result.warningAt).toBe(Number.POSITIVE_INFINITY);
    });

    it('returns exceeded=true when count >= BASIC limit', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ plan: 'BASIC' });
      prismaMock.product.count.mockResolvedValue(100);

      const result = await service.getLimitStatus('products', 'org-1');

      expect(result.exceeded).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.current).toBe(100);
      expect(result.warningAt).toBe(80);
    });

    it('returns warning state at 80% of limit', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ plan: 'BASIC' });
      prismaMock.customer.count.mockResolvedValue(40);

      const result = await service.getLimitStatus('customers', 'org-1');

      expect(result.exceeded).toBe(false);
      expect(result.current).toBe(40);
      expect(result.limit).toBe(50);
      expect(result.warningAt).toBe(40);
    });

    it('returns exceeded for missing organization', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      const result = await service.getLimitStatus('users', 'org-missing');

      expect(result.exceeded).toBe(true);
      expect(result.limit).toBe(0);
    });
  });

  describe('count with cache', () => {
    it('counts users correctly', async () => {
      prismaMock.organizationUser.count.mockResolvedValue(2);

      const result = await service.count('users', 'org-1');

      expect(result).toBe(2);
      expect(prismaMock.organizationUser.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
      });
    });

    it('counts products with active filter', async () => {
      prismaMock.product.count.mockResolvedValue(50);

      const result = await service.count('products', 'org-1');

      expect(result).toBe(50);
      expect(prismaMock.product.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', active: true },
      });
    });

    it('counts customers with active filter', async () => {
      prismaMock.customer.count.mockResolvedValue(30);

      const result = await service.count('customers', 'org-1');

      expect(result).toBe(30);
      expect(prismaMock.customer.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', active: true },
      });
    });

    it('counts cashRegisters with active filter', async () => {
      prismaMock.cashRegister.count.mockResolvedValue(1);

      const result = await service.count('cashRegisters', 'org-1');

      expect(result).toBe(1);
      expect(prismaMock.cashRegister.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', active: true },
      });
    });

    it('returns cached value within TTL', async () => {
      prismaMock.product.count.mockResolvedValue(10);

      const first = await service.count('products', 'org-1');
      expect(first).toBe(10);
      expect(prismaMock.product.count).toHaveBeenCalledTimes(1);

      const second = await service.count('products', 'org-1');
      expect(second).toBe(10);
      expect(prismaMock.product.count).toHaveBeenCalledTimes(1); // cache hit
    });

    it('refreshes cache after TTL expires', async () => {
      prismaMock.product.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(20);

      const first = await service.count('products', 'org-1');
      expect(first).toBe(10);

      jest.advanceTimersByTime(61_000); // 60s TTL + 1s buffer

      const second = await service.count('products', 'org-1');
      expect(second).toBe(20);
      expect(prismaMock.product.count).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkLimit', () => {
    it('returns allowed=true when under limit', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ plan: 'BASIC' });
      prismaMock.cashRegister.count.mockResolvedValue(0);

      const result = await service.checkLimit('cashRegisters', 'org-1');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
      expect(result.limit).toBe(1);
    });

    it('returns allowed=false when at limit', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ plan: 'BASIC' });
      prismaMock.cashRegister.count.mockResolvedValue(1);

      const result = await service.checkLimit('cashRegisters', 'org-1');

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(1);
      expect(result.limit).toBe(1);
    });
  });

  describe('invalidateCache', () => {
    it('removes cache entry', async () => {
      prismaMock.product.count.mockResolvedValue(10);

      await service.count('products', 'org-1');
      expect(prismaMock.product.count).toHaveBeenCalledTimes(1);

      service.invalidateCache('products', 'org-1');

      await service.count('products', 'org-1');
      expect(prismaMock.product.count).toHaveBeenCalledTimes(2);
    });
  });
});
