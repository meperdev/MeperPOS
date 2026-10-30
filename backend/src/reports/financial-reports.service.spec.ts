import { Prisma } from '@prisma/client';
import { ReportsService } from './reports.service';

const decimal = (value: string | number) => new Prisma.Decimal(value);

describe('ReportsService financial read model', () => {
  const prismaMock = {
    sale: { findMany: jest.fn() },
    payment: { findMany: jest.fn(), groupBy: jest.fn() },
    expensePayment: { findMany: jest.fn() },
    payrollCashOutflow: { findMany: jest.fn() },
    product: { findMany: jest.fn() },
    inventoryMovement: { findMany: jest.fn() },
  };
  const cacheMock = { get: jest.fn(), set: jest.fn() };
  const expensesMock = { findForReports: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    // Cash flow reads payroll cash facts too; this spec keeps them empty unless a
    // test supplies them.
    prismaMock.payrollCashOutflow.findMany.mockResolvedValue([]);
  });

  it('queries completed sales and expenses by the organization and equivalent ranges', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);
    expensesMock.findForReports.mockResolvedValue([]);
    const service = new ReportsService(
      prismaMock as never,
      cacheMock as never,
      expensesMock as never,
    );

    const result = await service.getFinancialOverview(
      'org-a',
      '2026-03-10',
      '2026-03-12',
    );

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          OR: expect.arrayContaining([
            { createdAt: expect.any(Object) },
            { cancelledAt: expect.any(Object) },
            { inventoryMovements: { some: expect.any(Object) } },
          ]),
        }),
      }),
    );
    expect(expensesMock.findForReports).toHaveBeenCalledWith(
      'org-a',
      expect.any(Date),
      expect.any(Date),
    );
    expect(result.comparisonRange).toEqual({
      startDate: '2026-03-07',
      endDate: '2026-03-09',
      timezone: 'America/Bogota',
    });
  });

  it('returns decimal strings and keeps previous-period comparison separate', async () => {
    prismaMock.sale.findMany
      .mockResolvedValueOnce([
        {
          createdAt: new Date('2026-03-11T15:00:00.000Z'),
          cancelledAt: null,
          status: 'COMPLETED',
          subtotal: decimal('100.00'),
          discountAmount: decimal('0.00'),
          taxAmount: decimal('19.00'),
          items: [
            {
              quantity: 1,
              subtotal: decimal('100.00'),
              discountAmount: decimal('0.00'),
              costPriceSnapshot: decimal('40.00'),
              productId: 'p-1',
              product: { name: 'A', category: { name: 'General' } },
            },
          ],
          inventoryMovements: [],
        },
      ])
      .mockResolvedValueOnce([]);
    expensesMock.findForReports.mockResolvedValue([
      { total: decimal('10.00'), purchaseOrderId: null },
    ]);
    const service = new ReportsService(
      prismaMock as never,
      cacheMock as never,
      expensesMock as never,
    );

    const result = await service.getFinancialOverview(
      'org-a',
      '2026-03-10',
      '2026-03-12',
    );

    expect(result.current.netIncome).toBe('100.00');
    expect(result.current.cogs).toBe('40.00');
    expect(result.current.netProfit).toBe('50.00');
    expect(result.previous.netIncome).toBe('0.00');
    expect(result.deltas.netIncome).toEqual({
      absolute: '100.00',
      percentage: 100,
    });
    expect(result.current.netIncome).toEqual(expect.any(String));
  });

  it('applies cancellation and return events in their period without requiring the sale creation period', async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-02-20T15:00:00.000Z'),
        cancelledAt: new Date('2026-03-11T15:00:00.000Z'),
        status: 'CANCELLED',
        subtotal: decimal('100.00'),
        discountAmount: decimal('10.00'),
        taxAmount: decimal('19.00'),
        items: [
          {
            quantity: 2,
            subtotal: decimal('100.00'),
            discountAmount: decimal('10.00'),
            costPriceSnapshot: decimal('40.00'),
            productId: 'p-1',
            product: { name: 'A', category: { name: 'General' } },
          },
        ],
        inventoryMovements: [
          {
            type: 'RETURN',
            quantity: 1,
            createdAt: new Date('2026-03-12T15:00:00.000Z'),
            productId: 'p-1',
          },
        ],
      },
      {
        createdAt: new Date('2026-02-20T15:00:00.000Z'),
        cancelledAt: null,
        status: 'RETURNED_PARTIAL',
        subtotal: decimal('100.00'),
        discountAmount: decimal('10.00'),
        taxAmount: decimal('19.00'),
        items: [
          {
            quantity: 2,
            subtotal: decimal('100.00'),
            discountAmount: decimal('10.00'),
            costPriceSnapshot: decimal('40.00'),
            productId: 'p-1',
            product: { name: 'A', category: { name: 'General' } },
          },
        ],
        inventoryMovements: [
          {
            type: 'RETURN',
            quantity: 1,
            createdAt: new Date('2026-03-12T15:00:00.000Z'),
            productId: 'p-1',
          },
        ],
      },
    ]);
    expensesMock.findForReports.mockResolvedValue([]);
    const service = new ReportsService(
      prismaMock as never,
      cacheMock as never,
      expensesMock as never,
    );

    const result = await service.getFinancialOverview(
      'org-a',
      '2026-03-10',
      '2026-03-12',
    );

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          OR: expect.arrayContaining([
            { createdAt: expect.any(Object) },
            { cancelledAt: expect.any(Object) },
            {
              inventoryMovements: {
                some: { type: 'RETURN', createdAt: expect.any(Object) },
              },
            },
          ]),
        }),
      }),
    );
    expect(result.current.netIncome).toBe('-135.00');
    expect(result.current.cogs).toBe('-120.00');
    expect(result.current.grossProfit).toBe('-15.00');
  });

  it('never builds a financial query without the requested organization', async () => {
    const service = new ReportsService(
      prismaMock as never,
      cacheMock as never,
      expensesMock as never,
    );

    await expect(service.getFinancialOverview(undefined)).rejects.toThrow(
      'Organization ID is required for reports',
    );
    expect(prismaMock.sale.findMany).not.toHaveBeenCalled();
  });

  it('reports sale collections and expense payments by payment date and method', async () => {
    prismaMock.payment.groupBy.mockResolvedValue([
      {
        method: 'CASH',
        _sum: { amount: decimal('10.25') },
        _count: { method: 1 },
      },
      {
        method: 'CARD',
        _sum: { amount: decimal('5.75') },
        _count: { method: 1 },
      },
    ]);
    prismaMock.expensePayment.findMany.mockResolvedValue([
      {
        amount: decimal('3.50'),
        method: 'TRANSFER',
        date: new Date('2026-03-12'),
      },
    ]);
    const service = new ReportsService(prismaMock as never, cacheMock as never);

    const result = await service.getCashFlow(
      'org-a',
      '2026-03-10',
      '2026-03-12',
    );

    expect(prismaMock.payment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['method'],
        where: expect.objectContaining({
          organizationId: 'org-a',
          createdAt: expect.any(Object),
          sale: { status: 'COMPLETED' },
        }),
        // Deterministic-by-contract group order (maintainer decision obs #411).
        orderBy: { method: 'asc' },
      }),
    );
    expect(prismaMock.expensePayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Tenant and period stay asserted, plus the payroll-link relation filter as an
        // exact value: no `active` sub-filter can hide inside it, so unlinked expense
        // payments keep their deliberately inactive-blind behaviour.
        where: expect.objectContaining({
          organizationId: 'org-a',
          date: expect.any(Object),
          expense: { payrollObligationExpense: { is: null } },
        }),
      }),
    );
    expect(result.collections.total).toBe('16.00');
    expect(result.collections.byPaymentMethod).toEqual([
      { paymentMethod: 'CASH', total: '10.25', count: 1 },
      { paymentMethod: 'CARD', total: '5.75', count: 1 },
    ]);
    expect(result.expensePayments.total).toBe('3.50');
  });

  it('returns current inventory valuation and period movement quantities separately', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { stock: 3, costPrice: decimal('10.00'), salePrice: decimal('18.00') },
      { stock: 2, costPrice: decimal('4.50'), salePrice: decimal('9.00') },
    ]);
    prismaMock.inventoryMovement.findMany.mockResolvedValue([
      { type: 'SALE', quantity: 2 },
      { type: 'RETURN', quantity: 1 },
    ]);
    const service = new ReportsService(prismaMock as never, cacheMock as never);

    const result = await service.getInventorySnapshot(
      'org-a',
      '2026-03-10',
      '2026-03-12',
    );

    expect(result.isCurrentSnapshot).toBe(true);
    expect(result.valuationBasis).toBe('CURRENT_STOCK_AT_CURRENT_COST');
    expect(result.current.stockValue).toBe('39.00');
    expect(result.current.retailValue).toBe('72.00');
    expect(result.current.potentialProfit).toBe('33.00');
    expect(result.movements).toEqual({
      totalQuantity: 3,
      byType: { SALE: 2, RETURN: 1 },
    });
    // A service is sold labour, so the valuation must only ever ask for products.
    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-a',
          active: true,
          type: 'PRODUCT',
          tracksStock: true,
        },
      }),
    );
  });
});
