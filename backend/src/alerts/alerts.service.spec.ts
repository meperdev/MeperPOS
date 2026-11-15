import { OrgRole } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PlanLimitService } from '../plan-limits/plan-limits.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from './alerts.service';

const MIN_STOCK_FIELD = { name: 'minStock' };

const user = (over: Partial<RequestUser> = {}): RequestUser => ({
  userId: 'u1',
  email: 'admin@org.demo',
  organizationId: 'org-1',
  role: OrgRole.ADMIN,
  tokenVersion: 0,
  isSuperAdmin: false,
  ...over,
});

function build() {
  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        status: 'ACTIVE',
        trialEndsAt: null,
      }),
    },
    product: {
      fields: { minStock: MIN_STOCK_FIELD },
      findMany: jest.fn().mockResolvedValue([]),
    },
    moneyLoan: { findMany: jest.fn().mockResolvedValue([]) },
    task: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const planLimits = {
    getLimitStatus: jest.fn().mockResolvedValue({
      type: 'users',
      current: 1,
      limit: 3,
      exceeded: false,
      warningAt: 2,
    }),
  };
  const service = new AlertsService(
    prisma as unknown as PrismaService,
    planLimits as unknown as PlanLimitService,
  );
  return { service, prisma, planLimits };
}

describe('AlertsService', () => {
  it('returns nothing for an account without an organization scope', async () => {
    const { service, prisma } = build();

    await expect(
      service.list(user({ organizationId: undefined, role: 'SUPER_ADMIN' })),
    ).resolves.toEqual([]);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('returns nothing when the organization row is gone', async () => {
    const { service, prisma } = build();
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.list(user())).resolves.toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('gathers every signal for an administrator', async () => {
    const { service, prisma, planLimits } = build();

    await service.list(user());

    expect(planLimits.getLimitStatus).toHaveBeenCalledTimes(4);
    expect(planLimits.getLimitStatus).toHaveBeenCalledWith('users', 'org-1');
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          active: true,
          type: 'PRODUCT',
          tracksStock: true,
          stock: { lte: MIN_STOCK_FIELD },
        }),
      }),
    );
    expect(prisma.moneyLoan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1' }),
      }),
    );
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1' }),
      }),
    );
  });

  it('skips plan limits and stock for a cashier', async () => {
    const { service, prisma, planLimits } = build();

    await service.list(user({ role: OrgRole.CASHIER }));

    expect(planLimits.getLimitStatus).not.toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.moneyLoan.findMany).toHaveBeenCalled();
  });

  it('gives inventory staff the stock signal without billing', async () => {
    const { service, prisma, planLimits } = build();

    await service.list(user({ role: OrgRole.INVENTORY_USER }));

    expect(planLimits.getLimitStatus).not.toHaveBeenCalled();
    expect(prisma.product.findMany).toHaveBeenCalled();
    expect(prisma.moneyLoan.findMany).toHaveBeenCalled();
  });

  it('returns the built stock alert for an administrator', async () => {
    const { service, prisma } = build();
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', stock: 2, minStock: 5 },
    ]);

    const alerts = await service.list(user());

    expect(alerts.map((alert) => alert.id)).toContain('stock:low');
  });

  it('asks for loans that are open and due before now', async () => {
    const { service, prisma } = build();

    await service.list(user());

    const where = prisma.moneyLoan.findMany.mock.calls[0][0].where as {
      status: string;
      dueAt: { lt: Date };
    };
    expect(where.status).toBe('OPEN');
    expect(where.dueAt.lt).toBeInstanceOf(Date);
  });

  it('asks only for open tasks that are past their due date', async () => {
    const { service, prisma } = build();

    await service.list(user());

    const where = prisma.task.findMany.mock.calls[0][0].where as {
      deletedAt: null;
      status: { notIn: string[] };
      dueDate: { lt: Date };
    };
    expect(where.deletedAt).toBeNull();
    expect(where.status.notIn).toEqual(['COMPLETED', 'CANCELLED']);
    expect(where.dueDate.lt).toBeInstanceOf(Date);
  });

  it('keeps the stock alert when the loans query fails', async () => {
    const { service, prisma } = build();
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', stock: 2, minStock: 5 },
    ]);
    prisma.moneyLoan.findMany.mockRejectedValue(new Error('timeout'));

    const alerts = await service.list(user());

    expect(alerts.map((alert) => alert.id)).toEqual(['stock:low']);
  });

  it('keeps every category when one plan-limit lookup fails', async () => {
    const { service, planLimits } = build();
    planLimits.getLimitStatus
      .mockResolvedValueOnce({
        type: 'users',
        current: 1,
        limit: 3,
        exceeded: false,
        warningAt: 2,
      })
      .mockRejectedValueOnce(new Error('count failed'))
      .mockResolvedValue({
        type: 'products',
        current: 1,
        limit: 100,
        exceeded: false,
        warningAt: 80,
      });

    await expect(service.list(user())).resolves.toEqual([]);
    expect(planLimits.getLimitStatus).toHaveBeenCalledTimes(4);
  });

  it('does not let a failing tasks query empty the feed', async () => {
    const { service, prisma } = build();
    prisma.task.findMany.mockRejectedValue(new Error('db down'));
    prisma.organization.findUnique.mockResolvedValue({
      status: 'PAST_DUE',
      trialEndsAt: null,
    });

    const alerts = await service.list(user());

    expect(alerts.map((alert) => alert.id)).toEqual(['billing:past-due']);
  });
});
