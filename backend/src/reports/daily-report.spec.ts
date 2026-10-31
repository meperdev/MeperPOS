import { Prisma, ProductType, OrgRole } from '@prisma/client';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { DailyReportController } from './daily-report.controller';
import { DailyReportService } from './daily-report.service';
import { renderDailyReportPdf } from './daily-report.pdf';

describe('daily report public service', () => {
  const cutoff = new Date('2025-01-02T02:00:00.000Z');
  let tx: any;
  let service: DailyReportService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(cutoff);
    tx = {
      sale: { findMany: jest.fn().mockResolvedValue([]) },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseOrder: { findMany: jest.fn().mockResolvedValue([]) },
      moneyLoan: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = { $transaction: jest.fn((fn) => fn(tx)) };
    service = new DailyReportService(prisma as never);
  });
  afterEach(() => jest.useRealTimers());

  it('captures a single cutoff and scopes every query to the organization', async () => {
    const report = await service.generate('org-a');
    expect(report.cutoff).toEqual(cutoff);
    expect(report.date).toBe('2025-01-01');
    for (const model of [
      tx.sale,
      tx.expense,
      tx.product,
      tx.purchaseOrder,
      tx.moneyLoan,
    ]) {
      expect(model.findMany.mock.calls[0][0].where.organizationId).toBe(
        'org-a',
      );
    }
    expect(tx.sale.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2025-01-01T05:00:00.000Z'),
      lte: cutoff,
    });
    expect(tx.moneyLoan.findMany.mock.calls[0][0].where.dueAt.lte).toEqual(
      new Date('2025-01-04T00:00:00.000Z'),
    );
  });

  it.each([
    [
      '2025-01-02T04:59:59.000Z',
      '2025-01-01',
      '2025-01-01T05:00:00.000Z',
      '2025-01-02T00:00:00.000Z',
    ],
    [
      '2025-01-02T05:00:00.000Z',
      '2025-01-02',
      '2025-01-02T05:00:00.000Z',
      '2025-01-03T00:00:00.000Z',
    ],
  ])(
    'filters date-only expenses and timestamped expenses at cutoff %s',
    async (instant, day, start, nextDay) => {
      const requestTime = new Date(instant);
      jest.setSystemTime(requestTime);
      const report = await service.generate('org-a');
      const where = tx.expense.findMany.mock.calls[0][0].where;
      expect(report.date).toBe(day);
      expect(where.createdAt).toEqual({ lte: requestTime });
      expect(where.OR).toEqual([
        { date: new Date(`${day}T00:00:00.000Z`) },
        {
          date: {
            gte: new Date(start),
            lte: requestTime,
            not: new Date(nextDay),
          },
        },
      ]);
    },
  );

  it('includes today’s UTC-midnight date-only expense but not tomorrow or after-cutoff entries', async () => {
    const rows = [
      {
        id: 'today',
        date: new Date('2025-01-01T00:00:00Z'),
        createdAt: new Date('2025-01-02T01:00:00Z'),
      },
      {
        id: 'tomorrow',
        date: new Date('2025-01-02T00:00:00Z'),
        createdAt: new Date('2025-01-02T01:00:00Z'),
      },
      {
        id: 'after',
        date: new Date('2025-01-01T00:00:00Z'),
        createdAt: new Date('2025-01-02T02:00:01Z'),
      },
      {
        id: 'timestamp',
        date: new Date('2025-01-02T01:00:00Z'),
        createdAt: new Date('2025-01-02T01:00:00Z'),
      },
      {
        id: 'future-time',
        date: new Date('2025-01-02T03:00:00Z'),
        createdAt: new Date('2025-01-02T01:00:00Z'),
      },
    ];
    tx.expense.findMany.mockImplementation(({ where }: any) => {
      const rules = where.OR ?? [{ date: where.date }];
      return Promise.resolve(
        rows
          .filter(
            (row) =>
              row.createdAt <= where.createdAt.lte &&
              rules.some(({ date }: any) =>
                date instanceof Date
                  ? +row.date === +date
                  : row.date >= date.gte &&
                    row.date <= date.lte &&
                    (!date.not || +row.date !== +date.not),
              ),
          )
          .map((row) => ({
            ...row,
            total: new Prisma.Decimal(1),
            label: { name: 'Expense' },
          })),
      );
    });
    const report = await service.generate('org-a');
    expect(report.expenses.map((row) => row.id)).toEqual([
      'today',
      'timestamp',
    ]);
    expect(report.expenseTotal).toBe('2.00');
  });

  it('switches date-only expense inclusion at Bogotá midnight', async () => {
    const previous = new Date('2025-01-01T00:00:00Z');
    const next = new Date('2025-01-02T00:00:00Z');
    tx.expense.findMany.mockImplementation(({ where }: any) => {
      const values = [previous, next].filter((date) =>
        where.OR.some(({ date: filter }: any) =>
          filter instanceof Date
            ? +date === +filter
            : date >= filter.gte && date <= filter.lte && +date !== +filter.not,
        ),
      );
      return Promise.resolve(
        values.map((date) => ({
          id: date.toISOString(),
          date,
          total: new Prisma.Decimal(1),
          label: { name: 'Expense' },
        })),
      );
    });
    jest.setSystemTime(new Date('2025-01-02T04:59:59Z'));
    expect((await service.generate('org-a')).expenses.map((e) => e.id)).toEqual(
      [previous.toISOString()],
    );
    jest.setSystemTime(new Date('2025-01-02T05:00:00Z'));
    expect((await service.generate('org-a')).expenses.map((e) => e.id)).toEqual(
      [next.toISOString()],
    );
  });

  it('uses existing domain filters, decimal arithmetic and tenant-safe relations', async () => {
    const d = (value: string) => new Prisma.Decimal(value);
    tx.sale.findMany.mockResolvedValue([
      {
        id: 's',
        saleNumber: 1,
        createdAt: cutoff,
        total: d('0.10'),
        customer: {
          organizationId: 'foreign',
          name: 'Secret',
          documentNumber: 'secret',
        },
        items: [
          {
            quantity: 2,
            unitPrice: d('0.05'),
            total: d('0.10'),
            product: { name: 'Product', sku: 'A' },
          },
        ],
      },
    ]);
    tx.expense.findMany.mockResolvedValue([
      { total: d('0.20'), label: { name: 'Rent' } },
    ]);
    tx.moneyLoan.findMany.mockResolvedValue([
      {
        amount: d('1.00'),
        customer: { organizationId: 'org-a', name: 'Alice' },
        supplier: null,
        events: [
          { type: 'COLLECTED', amount: d('0.30') },
          { type: 'REVERSED', amount: d('0.10') },
        ],
      },
    ]);
    const report = await service.generate('org-a');
    expect(report.salesTotal).toBe('0.10');
    expect(report.expenseTotal).toBe('0.20');
    expect(report.sales[0].customer).toBeNull();
    expect(report.sales[0].items[0].product.name).toBe('Product');
    expect(report.loans[0]).toMatchObject({
      balance: '0.80',
      customer: 'Alice',
    });
    expect(tx.sale.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'COMPLETED' },
      select: {
        items: {
          where: {
            organizationId: 'org-a',
            product: { organizationId: 'org-a' },
          },
        },
      },
    });
    expect(tx.expense.findMany.mock.calls[0][0].where).toMatchObject({
      active: true,
      label: { organizationId: 'org-a' },
      createdAt: { lte: cutoff },
    });
    expect(tx.purchaseOrder.findMany.mock.calls[0][0].where).toMatchObject({
      status: { in: ['PENDING', 'PARTIAL_RECEIVED'] },
      supplier: { organizationId: 'org-a' },
    });
    expect(tx.moneyLoan.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'OPEN',
      dueAt: { lte: new Date('2025-01-04T00:00:00Z') },
    });
  });

  it('renders cutoff and sale timestamps in Bogotá and preserves Spanish names in extracted PDF text', async () => {
    tx.sale.findMany.mockResolvedValue([
      {
        id: 's',
        saleNumber: 1,
        createdAt: new Date('2025-01-02T05:03:04.000Z'),
        total: new Prisma.Decimal('1'),
        customer: {
          organizationId: 'org-a',
          name: 'Jose\u0301 Mun\u0303oz A\u0301lvarez',
          documentNumber: '123',
        },
        items: [
          {
            quantity: 1,
            unitPrice: new Prisma.Decimal('1'),
            total: new Prisma.Decimal('1'),
            product: { name: 'Piñón suspensión año', sku: 'A' },
          },
        ],
      },
    ]);
    const pdf = renderDailyReportPdf(await service.generate('org-a'));
    jest.useRealTimers();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const parse = require('pdf-parse/lib/pdf-parse.js') as (
      data: Uint8Array,
    ) => Promise<{ text: string }>;
    const text = (await parse(new Uint8Array(pdf))).text;
    expect(text).toContain('2025-01-01 21:00:00');
    expect(text).toContain('2025-01-02 00:03:04');
    expect(text).toContain('America/Bogota');
    expect(text).toContain('José Muñoz Álvarez');
    expect(text).toContain('Piñón suspensión año');
  });

  it('does not invent an employee or disclose a foreign counterparty in the PDF', async () => {
    tx.moneyLoan.findMany.mockResolvedValue([
      {
        id: 'unknown',
        amount: new Prisma.Decimal(10),
        dueAt: new Date('2025-01-01T00:00:00Z'),
        reason: 'Unknown counterparty',
        customer: null,
        supplier: null,
        events: [],
      },
      {
        id: 'foreign',
        amount: new Prisma.Decimal(20),
        dueAt: new Date('2025-01-01T00:00:00Z'),
        reason: 'Foreign counterparty',
        customer: { organizationId: 'org-b', name: 'FOREIGN SECRET' },
        supplier: null,
        events: [],
      },
    ]);
    const report = await service.generate('org-a');
    const pdf = renderDailyReportPdf(report).toString('latin1');
    expect(pdf.match(/Contraparte no disponible/g)).toHaveLength(2);
    expect(pdf).not.toContain('Empleado');
    expect(pdf).not.toContain('FOREIGN SECRET');
    expect(report.loans[1].customer).toBeNull();
  });

  it('renders all long sale and customer details across pages', async () => {
    const name = Array.from({ length: 1000 }, (_, i) => `Product${i}`).join(
      ' ',
    );
    tx.sale.findMany.mockResolvedValue([
      {
        id: 's',
        saleNumber: 1,
        createdAt: cutoff,
        total: new Prisma.Decimal('1'),
        customer: {
          organizationId: 'org-a',
          name: 'Customer full name',
          documentNumber: '123',
        },
        items: [
          {
            quantity: 1,
            unitPrice: new Prisma.Decimal('1'),
            total: new Prisma.Decimal('1'),
            product: { name, sku: 'last-sku' },
          },
        ],
      },
    ]);
    const bytes = renderDailyReportPdf(await service.generate('org-a'));
    const raw = bytes.toString('latin1');
    expect(raw).toContain('Customer full name');
    expect(raw).toContain('Product0');
    expect(raw).toContain('Product999');
    expect(raw).toContain('last-sku');
    expect((raw.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it('fails closed without an organization and uses the stock authority', async () => {
    await expect(service.generate(undefined)).rejects.toThrow();
    expect(tx.sale.findMany).not.toHaveBeenCalled();
    tx.product.findMany.mockResolvedValue([
      {
        name: 'Low',
        type: ProductType.PRODUCT,
        tracksStock: true,
        stock: 2,
        minStock: 2,
      },
      {
        name: 'Service',
        type: ProductType.SERVICE,
        tracksStock: false,
        stock: 0,
        minStock: 2,
      },
      {
        name: 'Enough',
        type: ProductType.PRODUCT,
        tracksStock: true,
        stock: 3,
        minStock: 2,
      },
    ]);
    const report = await service.generate('org-a');
    expect(report.lowStock.map((p) => p.name)).toEqual(['Low']);
    expect(report.salesTotal).toBe(new Prisma.Decimal(0).toFixed(2));
  });
});

describe('daily report authorization boundary', () => {
  const guard = new RolesGuard(new Reflector());
  const context = (method: 'get' | 'pdf', role: OrgRole) =>
    ({
      getHandler: () => DailyReportController.prototype[method],
      getClass: () => DailyReportController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as unknown as ExecutionContext;

  it('installs authentication, role and organization guards and admin scope interceptor', () => {
    expect(Reflect.getMetadata('__guards__', DailyReportController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
      OrganizationRequiredGuard,
    ]);
    expect(
      Reflect.getMetadata('__interceptors__', DailyReportController),
    ).toEqual([AdminOrganizationInterceptor]);
  });
  it('allows a super administrator only through a selected organization', async () => {
    const generate = jest.fn().mockRejectedValue(new ForbiddenException());
    const controller = new DailyReportController({ generate } as never);
    await expect(
      controller.get({ isSuperAdmin: true } as never),
    ).rejects.toThrow(ForbiddenException);
    expect(generate).toHaveBeenCalledWith(undefined);
  });
  it.each(Object.values(OrgRole))(
    'requires administrator permission for %s',
    (role) => {
      for (const method of ['get', 'pdf'] as const) {
        if (role === OrgRole.OWNER || role === OrgRole.ADMIN)
          expect(guard.canActivate(context(method, role))).toBe(true);
        else
          expect(() => guard.canActivate(context(method, role))).toThrow(
            ForbiddenException,
          );
      }
    },
  );
});
