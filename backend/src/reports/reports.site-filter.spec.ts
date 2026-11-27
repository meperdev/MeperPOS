import { NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';

const SITE = 'site-a';
const START = '2026-03-01';
const END = '2026-03-31';

function createPrismaMock() {
  return {
    sale: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    user: { findMany: jest.fn() },
    product: { count: jest.fn(), findMany: jest.fn() },
    productStock: { findMany: jest.fn() },
    customer: { count: jest.fn(), findMany: jest.fn() },
    saleItem: { findMany: jest.fn(), groupBy: jest.fn() },
    payment: { groupBy: jest.fn() },
    inventoryMovement: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

/** Every read resolves to an empty org so a query shape is all a test observes. */
function prime(mock: PrismaMock) {
  mock.sale.findMany.mockResolvedValue([]);
  mock.sale.count.mockResolvedValue(0);
  mock.sale.aggregate.mockResolvedValue({ _sum: { total: null } });
  mock.sale.groupBy.mockResolvedValue([]);
  mock.user.findMany.mockResolvedValue([]);
  mock.product.count.mockResolvedValue(0);
  mock.product.findMany.mockResolvedValue([]);
  mock.productStock.findMany.mockResolvedValue([]);
  mock.customer.count.mockResolvedValue(0);
  mock.customer.findMany.mockResolvedValue([]);
  mock.saleItem.findMany.mockResolvedValue([]);
  mock.saleItem.groupBy.mockResolvedValue([]);
  mock.payment.groupBy.mockResolvedValue([]);
  mock.inventoryMovement.findMany.mockResolvedValue([]);
  mock.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
}

/** The `where` of the nth call of a mocked Prisma read. */
function whereOf(mock: jest.Mock, call = 0): Record<string, unknown> {
  return (mock.mock.calls[call][0] as { where: Record<string, unknown> }).where;
}

describe('ReportsService site filter', () => {
  let prismaMock: PrismaMock;
  let cacheMock: { get: jest.Mock; set: jest.Mock };
  let service: ReportsService;

  beforeEach(() => {
    prismaMock = createPrismaMock();
    prime(prismaMock);
    cacheMock = { get: jest.fn(), set: jest.fn() };
    service = new ReportsService(prismaMock as never, cacheMock as never);
  });

  describe('payment methods', () => {
    it('counts only sales whose stored origin is the requested site', async () => {
      await service.getSalesByPaymentMethod('org-1', START, END, SITE);

      expect(
        (whereOf(prismaMock.payment.groupBy).sale as Record<string, unknown>)
          .originSite,
      ).toEqual({ locationId: SITE });
    });

    it('answers the whole organization when no site is asked for', async () => {
      await service.getSalesByPaymentMethod('org-1', START, END);

      expect(whereOf(prismaMock.payment.groupBy).sale).not.toHaveProperty(
        'originSite',
      );
    });
  });

  describe('sales by category', () => {
    it('scopes the item totals and the partial returns to the site', async () => {
      await service.getSalesByCategory('org-1', START, END, SITE);

      expect(
        (whereOf(prismaMock.saleItem.groupBy).sale as Record<string, unknown>)
          .originSite,
      ).toEqual({ locationId: SITE });
      expect(whereOf(prismaMock.sale.findMany).originSite).toEqual({
        locationId: SITE,
      });
    });

    it('answers the whole organization when no site is asked for', async () => {
      await service.getSalesByCategory('org-1', START, END);

      expect(whereOf(prismaMock.saleItem.groupBy).sale).not.toHaveProperty(
        'originSite',
      );
      expect(whereOf(prismaMock.sale.findMany)).not.toHaveProperty(
        'originSite',
      );
    });
  });

  describe('daily sales by category', () => {
    it('scopes the item rows to the site', async () => {
      await service.getSalesByCategoryDaily('org-1', START, END, SITE);

      expect(
        (whereOf(prismaMock.saleItem.findMany).sale as Record<string, unknown>)
          .originSite,
      ).toEqual({ locationId: SITE });
    });

    it('answers the whole organization when no site is asked for', async () => {
      await service.getSalesByCategoryDaily('org-1', START, END);

      expect(whereOf(prismaMock.saleItem.findMany).sale).not.toHaveProperty(
        'originSite',
      );
    });
  });

  describe('top selling products', () => {
    it('ranks the site sales, partial returns included', async () => {
      await service.getTopSellingProducts('org-1', START, END, 10, SITE);

      expect(
        (whereOf(prismaMock.saleItem.groupBy).sale as Record<string, unknown>)
          .originSite,
      ).toEqual({ locationId: SITE });
      expect(whereOf(prismaMock.sale.findMany).originSite).toEqual({
        locationId: SITE,
      });
    });

    it('answers the whole organization when no site is asked for', async () => {
      await service.getTopSellingProducts('org-1', START, END, 10);

      expect(whereOf(prismaMock.saleItem.groupBy).sale).not.toHaveProperty(
        'originSite',
      );
    });
  });

  describe('customer statistics', () => {
    it('ranks the site customers and keeps the directory organization-wide', async () => {
      await service.getCustomerStatistics('org-1', START, END, SITE);

      expect(whereOf(prismaMock.sale.groupBy).originSite).toEqual({
        locationId: SITE,
      });
      expect(whereOf(prismaMock.customer.count)).not.toHaveProperty(
        'originSite',
      );
    });

    it('answers the whole organization when no site is asked for', async () => {
      await service.getCustomerStatistics('org-1', START, END);

      expect(whereOf(prismaMock.sale.groupBy)).not.toHaveProperty('originSite');
    });
  });

  describe('user performance', () => {
    it('counts the site sales of each seller in both periods', async () => {
      await service.getUserPerformance(
        'org-1',
        START,
        END,
        true,
        undefined,
        SITE,
      );

      expect(prismaMock.sale.findMany).toHaveBeenCalledTimes(2);
      expect(whereOf(prismaMock.sale.findMany, 0).originSite).toEqual({
        locationId: SITE,
      });
      expect(whereOf(prismaMock.sale.findMany, 1).originSite).toEqual({
        locationId: SITE,
      });
    });

    it('answers the whole organization when no site is asked for', async () => {
      await service.getUserPerformance('org-1', START, END, true);

      expect(whereOf(prismaMock.sale.findMany)).not.toHaveProperty(
        'originSite',
      );
    });
  });

  describe('daily sales series', () => {
    it('adds up the site days only', async () => {
      await service.getDailySales('org-1', START, END, SITE);

      expect(whereOf(prismaMock.sale.findMany).originSite).toEqual({
        locationId: SITE,
      });
    });

    it('answers the whole organization when no site is asked for', async () => {
      await service.getDailySales('org-1', START, END);

      expect(whereOf(prismaMock.sale.findMany)).not.toHaveProperty(
        'originSite',
      );
    });
  });

  describe('dashboard KPIs', () => {
    it('counts the site sales and leaves the catalog counters organization-wide', async () => {
      await service.getDashboardKPIs('org-1', START, END, SITE);

      expect(prismaMock.sale.count).toHaveBeenCalledTimes(3);
      for (const call of prismaMock.sale.count.mock.calls) {
        expect(
          (call[0] as { where: Record<string, unknown> }).where.originSite,
        ).toEqual({ locationId: SITE });
      }
      expect(whereOf(prismaMock.sale.findMany).originSite).toEqual({
        locationId: SITE,
      });
      expect(whereOf(prismaMock.product.count)).not.toHaveProperty(
        'originSite',
      );
    });

    it('answers the whole organization when no site is asked for', async () => {
      await service.getDashboardKPIs('org-1', START, END);

      for (const call of prismaMock.sale.count.mock.calls) {
        expect(
          (call[0] as { where: Record<string, unknown> }).where.originSite,
        ).toBeUndefined();
      }
    });

    it('keeps one cache entry per site and the organization key unchanged', async () => {
      await service.getDashboardKPIs('org-1', START, END);
      await service.getDashboardKPIs('org-1', START, END, SITE);

      expect(cacheMock.set.mock.calls[0][0]).toBe(
        `dashboard:org-1:${START}:${END}`,
      );
      expect(cacheMock.set.mock.calls[1][0]).toBe(
        `dashboard:org-1:${START}:${END}:${SITE}`,
      );
    });
  });

  describe('inventory snapshot', () => {
    it('values the stock the requested site holds and its own movements', async () => {
      prismaMock.productStock.findMany.mockResolvedValue([
        {
          stock: 4,
          product: {
            costPrice: new Prisma.Decimal('10.00'),
            salePrice: new Prisma.Decimal('25.00'),
          },
        },
      ]);

      const snapshot = await service.getInventorySnapshot(
        'org-1',
        START,
        END,
        SITE,
      );

      expect(whereOf(prismaMock.productStock.findMany)).toMatchObject({
        organizationId: 'org-1',
        locationId: SITE,
      });
      expect(whereOf(prismaMock.inventoryMovement.findMany).locationId).toBe(
        SITE,
      );
      expect(prismaMock.product.findMany).not.toHaveBeenCalled();
      expect(snapshot.current).toEqual({
        stockQuantity: 4,
        stockValue: '40.00',
        retailValue: '100.00',
        potentialProfit: '60.00',
      });
    });

    it('answers the organization aggregate and every movement without a site', async () => {
      prismaMock.product.findMany.mockResolvedValue([
        {
          stock: 4,
          costPrice: new Prisma.Decimal('10.00'),
          salePrice: new Prisma.Decimal('25.00'),
          type: 'PRODUCT',
          tracksStock: true,
        },
      ]);

      const snapshot = await service.getInventorySnapshot('org-1', START, END);

      expect(prismaMock.productStock.findMany).not.toHaveBeenCalled();
      // The organization-wide reads are byte-identical to the ones this report
      // always ran: the site filter is an addition, not a rewrite.
      expect(prismaMock.product.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          active: true,
          type: 'PRODUCT',
          tracksStock: true,
        },
        select: {
          stock: true,
          costPrice: true,
          salePrice: true,
          type: true,
          tracksStock: true,
        },
      });
      expect(prismaMock.inventoryMovement.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          createdAt: {
            gte: new Date('2026-03-01T05:00:00.000Z'),
            lte: new Date('2026-04-01T04:59:59.999Z'),
          },
          product: { type: 'PRODUCT', tracksStock: true },
        },
        select: { type: true, quantity: true },
      });
      expect(snapshot.current.stockValue).toBe('40.00');
    });
  });
});

describe('ReportsController site authorization', () => {
  const mockUser: RequestUser = {
    userId: 'user-1',
    email: 'test@example.com',
    organizationId: 'org-1',
    role: OrgRole.ADMIN,
    tokenVersion: 1,
    isSuperAdmin: false,
  };

  const serviceMock = {
    getDashboardKPIs: jest.fn(),
    getFinancialOverview: jest.fn(),
    getCashFlow: jest.fn(),
    getInventorySnapshot: jest.fn(),
    getSalesByPaymentMethod: jest.fn(),
    getSalesByCategory: jest.fn(),
    getSalesByCategoryDaily: jest.fn(),
    getTopSellingProducts: jest.fn(),
    getCustomerStatistics: jest.fn(),
    getUserPerformance: jest.fn(),
    getDailySales: jest.fn(),
  };
  const locationsMock = { findAccessible: jest.fn() };

  const controller = () =>
    new ReportsController(serviceMock as never, locationsMock as never);

  beforeEach(() => {
    jest.clearAllMocks();
    serviceMock.getSalesByCategory.mockResolvedValue({ data: [] });
    serviceMock.getInventorySnapshot.mockResolvedValue({});
    serviceMock.getDailySales.mockResolvedValue({ data: [] });
    serviceMock.getDashboardKPIs.mockResolvedValue({});
    serviceMock.getUserPerformance.mockResolvedValue({ data: [] });
  });

  it('resolves the site through the one site-access rule and forwards its id', async () => {
    locationsMock.findAccessible.mockResolvedValue({ id: SITE });

    await controller().getSalesByCategory(
      mockUser,
      START,
      END,
      'requested-site',
    );

    expect(locationsMock.findAccessible).toHaveBeenCalledWith(
      mockUser,
      'requested-site',
    );
    expect(serviceMock.getSalesByCategory).toHaveBeenCalledWith(
      'org-1',
      START,
      END,
      SITE,
    );
  });

  it('answers 404 for a site the caller cannot read and never runs the report', async () => {
    locationsMock.findAccessible.mockRejectedValue(
      new NotFoundException('Location not found'),
    );

    await expect(
      controller().getInventory(mockUser, START, END, 'foreign-site'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(serviceMock.getInventorySnapshot).not.toHaveBeenCalled();
  });

  it('passes no site to the service when the parameter is absent', async () => {
    await controller().getDailySales(mockUser, START, END);

    expect(locationsMock.findAccessible).not.toHaveBeenCalled();
    expect(serviceMock.getDailySales).toHaveBeenCalledWith(
      'org-1',
      START,
      END,
      undefined,
    );
  });

  it('scopes the dashboard and user performance queries to the resolved site', async () => {
    locationsMock.findAccessible.mockResolvedValue({ id: SITE });

    await controller().getDashboard(mockUser, START, END, 'requested-site');
    await controller().getUserPerformance(
      mockUser,
      START,
      END,
      'false',
      undefined,
      'requested-site',
    );

    expect(serviceMock.getDashboardKPIs).toHaveBeenCalledWith(
      'org-1',
      START,
      END,
      SITE,
    );
    expect(serviceMock.getUserPerformance).toHaveBeenCalledWith(
      'org-1',
      START,
      END,
      false,
      undefined,
      SITE,
    );
  });
});
