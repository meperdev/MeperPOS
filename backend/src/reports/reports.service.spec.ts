import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  const prismaMock = {
    sale: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    product: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    customer: {
      count: jest.fn(),
    },
    saleItem: {
      findMany: jest.fn(),
    },
    payment: {
      groupBy: jest.fn(),
    },
    expensePayment: {
      findMany: jest.fn(),
    },
    payrollCashOutflow: {
      findMany: jest.fn(),
    },
    inventoryMovement: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const cacheMock = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportsService(prismaMock as never, cacheMock as never);
  });

  it('rejects invalid ranges where endDate is before startDate', async () => {
    await expect(
      service.getSalesByPaymentMethod('org-1', '2026-03-10', '2026-03-05'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects dashboard KPIs without an organization context', async () => {
    await expect(
      service.getDashboardKPIs(undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes dashboard KPI queries to the requested organization', async () => {
    prismaMock.sale.count.mockResolvedValue(0);
    prismaMock.sale.aggregate.mockResolvedValue({ _sum: { total: null } });
    prismaMock.product.count.mockResolvedValue(0);
    prismaMock.customer.count.mockResolvedValue(0);
    prismaMock.sale.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([{ count: 3n }]);

    const result = (await service.getDashboardKPIs('org-1')) as {
      lowStockProducts: number;
    };

    expect(result.lowStockProducts).toBe(3);
    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', active: true },
    });
    expect(prismaMock.customer.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', active: true },
    });
  });

  it('returns appliedRange metadata with the queried date range', async () => {
    prismaMock.payment.groupBy.mockResolvedValue([
      { method: 'CASH', _sum: { amount: 120000 }, _count: { method: 2 } },
      { method: 'CARD', _sum: { amount: 50000 }, _count: { method: 1 } },
    ]);

    const result = await service.getSalesByPaymentMethod(
      'org-1',
      '2026-03-01',
      '2026-03-31',
    );

    expect(prismaMock.payment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['method'],
        where: expect.objectContaining({
          sale: expect.objectContaining({
            organizationId: 'org-1',
            status: 'COMPLETED',
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
        // Deterministic-by-contract group order (maintainer decision obs #411).
        orderBy: { method: 'asc' },
      }),
    );
    expect(result.appliedRange).toEqual({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      timezone: 'America/Bogota',
    });
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paymentMethod: 'CASH', total: 120000, count: 2 }),
        expect.objectContaining({ paymentMethod: 'CARD', total: 50000, count: 1 }),
      ]),
    );
  });

  it('[#16] returns empty-safe metrics for zero-data ranges', async () => {
    prismaMock.payment.groupBy.mockResolvedValue([]);

    const result = await service.getSalesByPaymentMethod(
      'org-1',
      '2026-04-01',
      '2026-04-30',
    );

    expect(result).toEqual({
      data: [],
      appliedRange: {
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        timezone: 'America/Bogota',
      },
    });
    expect(prismaMock.payment.groupBy).toHaveBeenCalledTimes(1);
  });

  it('keeps a selected user subset and shared comparison ranges in user performance analytics', async () => {
    prismaMock.sale.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        userId: 'user-1',
        total: 250000,
        customerId: 'customer-1',
      },
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', name: 'Ana' },
      { id: 'user-2', name: 'Luis' },
    ]);

    const result = await service.getUserPerformance(
      'org-1',
      '2026-03-10',
      '2026-03-12',
      true,
      ['user-1', 'user-2'],
    );

    expect(prismaMock.sale.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'COMPLETED',
          userId: { in: ['user-1', 'user-2'] },
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
    expect(prismaMock.sale.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'COMPLETED',
          userId: { in: ['user-1', 'user-2'] },
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['user-1', 'user-2'],
        },
        OR: [
          { organizationUsers: { some: { organizationId: 'org-1' } } },
          { sales: { some: { organizationId: 'org-1' } } },
        ],
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
    expect(result.appliedRange).toEqual({
      startDate: '2026-03-10',
      endDate: '2026-03-12',
      timezone: 'America/Bogota',
    });
    expect(result.comparisonRange).toEqual({
      startDate: '2026-03-07',
      endDate: '2026-03-09',
      timezone: 'America/Bogota',
    });
    expect(result.data).toEqual([
      {
        userId: 'user-1',
        userName: 'Ana',
        salesCount: 0,
        revenue: 0,
        avgTicket: 0,
        uniqueCustomers: 0,
        comparison: {
          revenuePct: -100,
          salesPct: -100,
        },
      },
      {
        userId: 'user-2',
        userName: 'Luis',
        salesCount: 0,
        revenue: 0,
        avgTicket: 0,
        uniqueCustomers: 0,
        comparison: {
          revenuePct: 0,
          salesPct: 0,
        },
      },
    ]);
  });

  it('omits an explicitly selected foreign user while keeping a shared member', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);
    const candidates = [
      {
        id: 'foreign-user',
        name: 'Foreign Name',
        organizations: ['org-2'],
        sales: ['org-2'],
      },
      {
        id: 'shared-user',
        name: 'Shared Name',
        organizations: ['org-1', 'org-2'],
        sales: [],
      },
    ];
    prismaMock.user.findMany.mockImplementation(
      ({
        where,
      }: {
        where: {
          id: { in: string[] };
          OR: Array<{
            organizationUsers?: { some: { organizationId: string } };
            sales?: { some: { organizationId: string } };
          }>;
        };
      }) =>
        Promise.resolve(
          candidates
            .filter(
              (user) =>
                where.id.in.includes(user.id) &&
                where.OR.some(
                  (branch) =>
                    (branch.organizationUsers &&
                      user.organizations.includes(
                        branch.organizationUsers.some.organizationId,
                      )) ||
                    (branch.sales &&
                      user.sales.includes(branch.sales.some.organizationId)),
                ),
            )
            .map(({ id, name }) => ({ id, name })),
        ),
    );

    const result = await service.getUserPerformance(
      'org-1',
      undefined,
      undefined,
      false,
      ['foreign-user', 'shared-user'],
    );

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['foreign-user', 'shared-user'] },
          OR: [
            { organizationUsers: { some: { organizationId: 'org-1' } } },
            { sales: { some: { organizationId: 'org-1' } } },
          ],
        },
      }),
    );
    expect(result.data).toEqual([
      expect.objectContaining({
        userId: 'shared-user',
        userName: 'Shared Name',
      }),
    ]);
  });

  it.each(['current', 'previous'] as const)(
    'retains a removed seller with %s org-scoped sales but hides unrelated selected users',
    async (period) => {
      const users = [
        { id: 'removed', name: 'Former Seller', organizations: [] },
        {
          id: 'shared',
          name: 'Shared Seller',
          organizations: ['org-1', 'org-2'],
        },
        { id: 'foreign', name: 'Foreign Seller', organizations: ['org-2'] },
      ];
      const selectedIds = users.map((user) => user.id);
      const saleRecords = [
        {
          userId: 'removed',
          total: 80,
          customerId: 'c1',
          organizationId: 'org-1',
          createdAt: new Date(
            period === 'current'
              ? '2026-03-11T12:00:00Z'
              : '2026-03-08T12:00:00Z',
          ),
        },
        {
          userId: 'shared',
          total: 30,
          customerId: 'c2',
          organizationId: 'org-1',
          createdAt: new Date('2026-03-11T12:00:00Z'),
        },
        {
          userId: 'shared',
          total: 900,
          customerId: 'c3',
          organizationId: 'org-2',
          createdAt: new Date('2026-03-11T12:00:00Z'),
        },
        {
          userId: 'foreign',
          total: 700,
          customerId: 'c4',
          organizationId: 'org-2',
          createdAt: new Date('2026-03-11T12:00:00Z'),
        },
      ];
      // Period sales are scoped; the User.sales relation checks all history.
      prismaMock.sale.findMany.mockImplementation(
        ({
          where,
        }: {
          where: {
            organizationId?: string;
            status: string;
            createdAt?: { gte: Date; lte: Date };
            userId?: { in: string[] };
          };
        }) =>
          Promise.resolve(
            saleRecords
              .filter(
                (sale) =>
                  (!where.organizationId ||
                    sale.organizationId === where.organizationId) &&
                  where.status === 'COMPLETED' &&
                  (!where.userId || where.userId.in.includes(sale.userId)) &&
                  (!where.createdAt ||
                    (sale.createdAt >= where.createdAt.gte &&
                      sale.createdAt <= where.createdAt.lte)),
              )
              .map(({ userId, total, customerId }) => ({
                userId,
                total,
                customerId,
              })),
          ),
      );
      prismaMock.user.findMany.mockImplementation(
        ({
          where,
        }: {
          where: {
            id: { in: string[] };
            OR: Array<{
              organizationUsers?: { some: { organizationId: string } };
              sales?: { some: { organizationId: string } };
            }>;
          };
        }) =>
          Promise.resolve(
            users
              .filter(
                (user) =>
                  where.id.in.includes(user.id) &&
                  where.OR.some(
                    (branch) =>
                      (branch.organizationUsers &&
                        user.organizations.includes(
                          branch.organizationUsers.some.organizationId,
                        )) ||
                      (branch.sales &&
                        saleRecords.some(
                          (sale) =>
                            sale.userId === user.id &&
                            sale.organizationId ===
                              branch.sales?.some.organizationId,
                        )),
                  ),
              )
              .map(({ id, name }) => ({ id, name })),
          ),
      );

      const result = await service.getUserPerformance(
        'org-1',
        '2026-03-10',
        '2026-03-12',
        true,
        selectedIds,
      );

      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: selectedIds },
            OR: [
              { organizationUsers: { some: { organizationId: 'org-1' } } },
              { sales: { some: { organizationId: 'org-1' } } },
            ],
          },
        }),
      );
      expect(result.data.map((row) => row.userId)).toEqual(
        period === 'current' ? ['removed', 'shared'] : ['shared', 'removed'],
      );
      expect(result.data.find((row) => row.userId === 'removed')).toEqual(
        expect.objectContaining({
          salesCount: period === 'current' ? 1 : 0,
          revenue: period === 'current' ? 80 : 0,
          comparison: {
            revenuePct: period === 'current' ? 100 : -100,
            salesPct: period === 'current' ? 100 : -100,
          },
        }),
      );
      expect(result.data.find((row) => row.userId === 'shared')).toEqual(
        expect.objectContaining({
          salesCount: 1,
          revenue: 30,
          uniqueCustomers: 1,
        }),
      );
    },
  );

  it('keeps global SuperAdmin name resolution unfiltered without an organization', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'foreign-user', name: 'Foreign Name' },
    ]);

    const result = await service.getUserPerformance(
      undefined,
      undefined,
      undefined,
      false,
      ['foreign-user'],
    );

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['foreign-user'] } },
      }),
    );
    expect(result.data).toEqual([
      expect.objectContaining({
        userId: 'foreign-user',
        userName: 'Foreign Name',
      }),
    ]);
  });

  it('groups sale items by Bogotá date and category for the stacked chart', async () => {
    prismaMock.saleItem.findMany.mockResolvedValue([
      {
        total: 50000,
        quantity: 2,
        sale: { createdAt: new Date('2026-08-21T15:00:00.000Z') },
        product: { category: { name: 'Bebidas' } },
      },
      {
        total: 30000,
        quantity: 1,
        sale: { createdAt: new Date('2026-08-21T15:00:00.000Z') },
        product: { category: { name: 'Snacks' } },
      },
      {
        total: 20000,
        quantity: 1,
        sale: { createdAt: new Date('2026-08-22T15:00:00.000Z') },
        product: { category: { name: 'Bebidas' } },
      },
    ]);

    const result = await service.getSalesByCategoryDaily(
      'org-1',
      '2026-08-20',
      '2026-08-26',
    );

    expect(prismaMock.saleItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sale: expect.objectContaining({
            status: 'COMPLETED',
            organizationId: 'org-1',
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      }),
    );

    expect(result.appliedRange).toEqual({
      startDate: '2026-08-20',
      endDate: '2026-08-26',
      timezone: 'America/Bogota',
    });
    expect(result.data).toEqual(
      expect.arrayContaining([
        { date: '2026-08-21', category: 'Bebidas', total: 50000, quantity: 2 },
        { date: '2026-08-21', category: 'Snacks', total: 30000, quantity: 1 },
        { date: '2026-08-22', category: 'Bebidas', total: 20000, quantity: 1 },
      ]),
    );
  });

  it('values inventory at list price, ignoring active promotions', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        stock: 10,
        costPrice: new Prisma.Decimal('2000'),
        salePrice: new Prisma.Decimal('5000'),
        promotionType: 'PERCENTAGE',
        promotionValue: new Prisma.Decimal('20'),
      },
    ]);
    prismaMock.inventoryMovement.findMany.mockResolvedValue([]);

    const result = await service.getInventorySnapshot('org-1');

    expect(result.current.retailValue).toBe('50000.00');
  });

  describe('getCashFlow payroll cash outflows', () => {
    const cashFlowPrisma = prismaMock as unknown as {
      payment: { groupBy: jest.Mock };
      expensePayment: { findMany: jest.Mock };
      payrollCashOutflow: { findMany: jest.Mock };
    };

    beforeEach(() => {
      cashFlowPrisma.payment.groupBy.mockResolvedValue([]);
      cashFlowPrisma.expensePayment.findMany.mockResolvedValue([]);
      cashFlowPrisma.payrollCashOutflow.findMany.mockResolvedValue([]);
    });

    it('excludes expense payments whose expense mirrors a payroll obligation', async () => {
      await service.getCashFlow('org-1', '2026-03-10', '2026-03-12');

      expect(cashFlowPrisma.expensePayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            date: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
            // The generated payroll expense is a mirror of cash already reported
            // by PayrollCashOutflow, so its payments must not be counted again.
            expense: { payrollObligationExpense: { is: null } },
          }),
        }),
      );
      // Unlinked expense behaviour is untouched: no invented `active` filter.
      const where = cashFlowPrisma.expensePayment.findMany.mock.calls[0][0]
        .where as Record<string, unknown>;
      expect(where).not.toHaveProperty('active');
      expect(where).not.toHaveProperty('expense.active');
    });

    it('keeps counting an unlinked expense payment', async () => {
      cashFlowPrisma.expensePayment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('120.00'), method: 'CASH' },
      ]);

      const result = await service.getCashFlow(
        'org-1',
        '2026-03-10',
        '2026-03-12',
      );

      expect(result.expensePayments.total).toBe('120.00');
      expect(result.expensePayments.byPaymentMethod).toEqual([
        { paymentMethod: 'CASH', total: '120.00', count: 1 },
      ]);
    });

    it('counts a payroll cash outflow even when no expense exists', async () => {
      // The generated expense is optional at completion: cash must still move.
      cashFlowPrisma.expensePayment.findMany.mockResolvedValue([]);
      cashFlowPrisma.payrollCashOutflow.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('2500000.00'), method: 'CASH' },
      ]);

      const result = await service.getCashFlow(
        'org-1',
        '2026-03-10',
        '2026-03-12',
      );

      expect(result.expensePayments.total).toBe('2500000.00');
      expect(result.expensePayments.byPaymentMethod).toEqual([
        { paymentMethod: 'CASH', total: '2500000.00', count: 1 },
      ]);
      expect(cashFlowPrisma.payrollCashOutflow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            date: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
          select: { amount: true, method: true },
        }),
      );
    });

    it('counts a payroll cash outflow exactly once alongside unlinked expense payments', async () => {
      cashFlowPrisma.expensePayment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('100.00'), method: 'CASH' },
      ]);
      cashFlowPrisma.payrollCashOutflow.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('250000.00'), method: 'CASH' },
      ]);

      const result = await service.getCashFlow(
        'org-1',
        '2026-03-10',
        '2026-03-12',
      );

      expect(result.expensePayments.total).toBe('250100.00');
      expect(result.expensePayments.byPaymentMethod).toEqual([
        { paymentMethod: 'CASH', total: '250100.00', count: 2 },
      ]);
    });

    it('sums same-day payroll cash outflows with the correct method breakdown', async () => {
      cashFlowPrisma.expensePayment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('10.25'), method: 'CARD' },
      ]);
      cashFlowPrisma.payrollCashOutflow.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('100.50'), method: 'CASH' },
        { amount: new Prisma.Decimal('200.25'), method: 'TRANSFER' },
      ]);

      const result = await service.getCashFlow(
        'org-1',
        '2026-03-10',
        '2026-03-12',
      );

      expect(result.expensePayments.total).toBe('311.00');
      expect(result.expensePayments.byPaymentMethod).toEqual([
        { paymentMethod: 'CARD', total: '10.25', count: 1 },
        { paymentMethod: 'CASH', total: '100.50', count: 1 },
        { paymentMethod: 'TRANSFER', total: '200.25', count: 1 },
      ]);
    });

    it('scopes payroll cash outflows and expense payments to the tenant', async () => {
      await service.getCashFlow('org-1', '2026-03-10', '2026-03-12');

      expect(
        cashFlowPrisma.payrollCashOutflow.findMany.mock.calls[0][0].where
          .organizationId,
      ).toBe('org-1');
      expect(
        cashFlowPrisma.expensePayment.findMany.mock.calls[0][0].where
          .organizationId,
      ).toBe('org-1');
      expect(
        cashFlowPrisma.payment.groupBy.mock.calls[0][0].where.organizationId,
      ).toBe('org-1');
    });

    it('keeps the cash flow response shape unchanged', async () => {
      cashFlowPrisma.payrollCashOutflow.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('50.00'), method: 'CASH' },
      ]);

      const result = await service.getCashFlow(
        'org-1',
        '2026-03-10',
        '2026-03-12',
      );

      expect(Object.keys(result).sort()).toEqual([
        'accountingBasis',
        'appliedRange',
        'collections',
        'expensePayments',
      ]);
      expect(result.accountingBasis).toBe('CASH_BY_PAYMENT_DATE');
      expect(Object.keys(result.expensePayments).sort()).toEqual([
        'byPaymentMethod',
        'total',
      ]);
    });
  });
});
