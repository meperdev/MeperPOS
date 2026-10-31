import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { DailyReportController } from './daily-report.controller';
import { DailyReportService } from './daily-report.service';
import type { PrismaService } from '../prisma/prisma.service';

// Opt-in only: never fall back to DATABASE_URL, load an env file, or clean up.
// These fixtures remain in the dedicated database, with a new namespace per run.
const testUrl = process.env.TEST_DATABASE_URL;
let databaseName = '';
if (testUrl) {
  let url: URL;
  try {
    url = new URL(testUrl);
  } catch {
    throw new Error(
      'TEST_DATABASE_URL must identify the dedicated local test database',
    );
  }
  const safeParameters = [...url.searchParams.entries()].every(
    ([key, value]) => key === 'schema' && value === 'public',
  );
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/meperpos_daily_report_test_[a-f0-9]{10}$/.test(url.pathname) ||
    !safeParameters
  ) {
    throw new Error(
      'TEST_DATABASE_URL must identify the dedicated local test database',
    );
  }
  databaseName = url.pathname.slice(1);
}

const describePostgres = testUrl ? describe : describe.skip;
describePostgres('daily report PostgreSQL public interface', () => {
  let db: PrismaClient;
  let controller: DailyReportController;
  const runId = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userId = randomUUID();
  const userB = randomUUID();
  const categoryA = randomUUID();
  const categoryB = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();
  const productA = randomUUID();
  const productB = randomUUID();
  const labelA = randomUUID();
  const labelB = randomUUID();
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const beforeCutoff = new Date('2025-01-01T12:00:00.000Z');
  const cutoff = new Date('2025-01-02T02:00:00.000Z');
  const date = (value: string) => new Date(value);

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: testUrl! } } });
    const identity = await db.$queryRaw<
      Array<{ database: string; schema: string }>
    >`SELECT current_database() AS database, current_schema() AS schema`;
    if (
      identity.length !== 1 ||
      identity[0].database !== databaseName ||
      identity[0].schema !== 'public'
    ) {
      throw new Error(
        'Connected database is not the dedicated test database and public schema',
      );
    }
    await db.organization.createMany({
      data: [
        { id: orgA, name: 'Synthetic A', slug: `daily-a-${runId}` },
        { id: orgB, name: 'Synthetic B', slug: `daily-b-${runId}` },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: userId,
          email: `a-${runId}@example.invalid`,
          password: 'not-a-login',
          name: 'Synthetic actor A',
        },
        {
          id: userB,
          email: `b-${runId}@example.invalid`,
          password: 'not-a-login',
          name: 'Synthetic actor B',
        },
      ],
    });
    await db.organizationUser.createMany({
      data: [
        { organizationId: orgA, userId, role: 'ADMIN' },
        { organizationId: orgB, userId: userB, role: 'ADMIN' },
      ],
    });
    await db.category.createMany({
      data: [
        { id: categoryA, name: 'Synthetic A', organizationId: orgA },
        { id: categoryB, name: 'Synthetic B', organizationId: orgB },
      ],
    });
    await db.customer.createMany({
      data: [
        {
          id: customerA,
          name: 'Synthetic customer A',
          documentType: 'CC',
          documentNumber: 'A',
          organizationId: orgA,
        },
        {
          id: customerB,
          name: 'Synthetic secret B',
          documentType: 'CC',
          documentNumber: 'B',
          organizationId: orgB,
        },
      ],
    });
    await db.product.createMany({
      data: [
        {
          id: productA,
          name: 'Low A',
          sku: 'low-a',
          organizationId: orgA,
          categoryId: categoryA,
          costPrice: 1,
          salePrice: 2,
          stock: 2,
          minStock: 2,
          createdAt: beforeCutoff,
        },
        {
          id: productB,
          name: 'Secret low B',
          sku: 'low-b',
          organizationId: orgB,
          categoryId: categoryB,
          costPrice: 1,
          salePrice: 2,
          stock: 0,
          minStock: 1,
          createdAt: beforeCutoff,
        },
        {
          name: 'Healthy A',
          sku: 'healthy',
          organizationId: orgA,
          categoryId: categoryA,
          costPrice: 1,
          salePrice: 2,
          stock: 3,
          minStock: 2,
          createdAt: beforeCutoff,
        },
        {
          name: 'Service A',
          sku: 'service',
          organizationId: orgA,
          categoryId: categoryA,
          costPrice: 1,
          salePrice: 2,
          stock: 0,
          minStock: 2,
          type: 'SERVICE',
          tracksStock: false,
          createdAt: beforeCutoff,
        },
        {
          name: 'Untracked A',
          sku: 'untracked',
          organizationId: orgA,
          categoryId: categoryA,
          costPrice: 1,
          salePrice: 2,
          stock: 0,
          minStock: 2,
          tracksStock: false,
          createdAt: beforeCutoff,
        },
      ],
    });
    await db.supplier.createMany({
      data: [
        {
          id: supplierA,
          name: 'Supplier A',
          documentNumber: 'A',
          organizationId: orgA,
        },
        {
          id: supplierB,
          name: 'Supplier B',
          documentNumber: 'B',
          organizationId: orgB,
        },
      ],
    });
    const groupA = randomUUID();
    const groupB = randomUUID();
    await db.expenseGroup.createMany({
      data: [
        { id: groupA, name: 'Group A', organizationId: orgA },
        { id: groupB, name: 'Group B', organizationId: orgB },
      ],
    });
    await db.expenseLabel.createMany({
      data: [
        { id: labelA, name: 'Label A', groupId: groupA, organizationId: orgA },
        { id: labelB, name: 'Label B', groupId: groupB, organizationId: orgB },
      ],
    });
    const saleStart = randomUUID();
    // Legacy single-column foreign keys permit these deliberately mismatched
    // relations; they exercise fail-closed reads, not normal domain writes.
    const foreignCustomerSale = randomUUID();
    await db.sale.createMany({
      data: [
        {
          id: saleStart,
          saleNumber: 1,
          organizationId: orgA,
          userId,
          customerId: customerA,
          subtotal: 10,
          taxAmount: 0,
          total: 10,
          amountPaid: 10,
          createdAt: date('2025-01-01T05:00:00Z'),
        },
        {
          id: foreignCustomerSale,
          saleNumber: 2,
          organizationId: orgA,
          userId,
          customerId: customerB,
          subtotal: 20,
          taxAmount: 0,
          total: 20,
          amountPaid: 20,
          createdAt: cutoff,
        },
        {
          saleNumber: 3,
          organizationId: orgA,
          userId,
          subtotal: 90,
          taxAmount: 0,
          total: 90,
          amountPaid: 90,
          createdAt: date('2025-01-01T04:59:59.999Z'),
        },
        {
          saleNumber: 4,
          organizationId: orgA,
          userId,
          subtotal: 90,
          taxAmount: 0,
          total: 90,
          amountPaid: 90,
          createdAt: date('2025-01-02T02:00:00.001Z'),
        },
        {
          saleNumber: 5,
          organizationId: orgA,
          userId,
          subtotal: 90,
          taxAmount: 0,
          total: 90,
          amountPaid: 90,
          status: 'CANCELLED',
          createdAt: beforeCutoff,
        },
        {
          saleNumber: 1,
          organizationId: orgB,
          userId: userB,
          customerId: customerB,
          subtotal: 70,
          taxAmount: 0,
          total: 70,
          amountPaid: 70,
          createdAt: beforeCutoff,
        },
      ],
    });
    await db.saleItem.createMany({
      data: [
        {
          saleId: saleStart,
          organizationId: orgA,
          productId: productA,
          quantity: 2,
          unitPrice: 5,
          taxRate: 0,
          subtotal: 10,
          total: 10,
        },
        {
          saleId: foreignCustomerSale,
          organizationId: orgA,
          productId: productB,
          quantity: 1,
          unitPrice: 20,
          taxRate: 0,
          subtotal: 20,
          total: 20,
        },
      ],
    });
    const expenses = [
      {
        description: 'date-only today',
        date: '2025-01-01T00:00:00Z',
        total: 1,
      },
      {
        description: 'timestamp start',
        date: '2025-01-01T05:00:00Z',
        total: 2,
      },
      {
        description: 'timestamp cutoff',
        date: '2025-01-02T02:00:00Z',
        total: 3,
      },
      {
        description: 'date-only tomorrow',
        date: '2025-01-02T00:00:00Z',
        total: 80,
      },
      {
        description: 'timestamp before start',
        date: '2025-01-01T04:59:59.999Z',
        total: 80,
      },
      {
        description: 'timestamp after cutoff',
        date: '2025-01-02T02:00:00.001Z',
        total: 80,
      },
    ];
    await db.expense.createMany({
      data: [
        ...expenses.map((entry) => ({
          ...entry,
          date: date(entry.date),
          status: 'PAID' as const,
          organizationId: orgA,
          labelId: labelA,
          createdById: userId,
          createdAt: beforeCutoff,
        })),
        {
          description: 'created after cutoff',
          date: date('2025-01-01T00:00:00Z'),
          total: 80,
          status: 'PAID',
          organizationId: orgA,
          labelId: labelA,
          createdById: userId,
          createdAt: date('2025-01-02T02:00:00.001Z'),
        },
        {
          description: 'foreign label',
          date: date('2025-01-01T00:00:00Z'),
          total: 80,
          status: 'PAID',
          organizationId: orgA,
          labelId: labelB,
          createdById: userId,
          createdAt: beforeCutoff,
        },
        {
          description: 'foreign org',
          date: date('2025-01-01T00:00:00Z'),
          total: 80,
          status: 'PAID',
          organizationId: orgB,
          labelId: labelB,
          createdById: userB,
          createdAt: beforeCutoff,
        },
      ],
    });
    await db.purchaseOrder.createMany({
      data: [
        {
          orderNumber: 1,
          organizationId: orgA,
          supplierId: supplierA,
          createdById: userId,
          status: 'PENDING',
          createdAt: beforeCutoff,
        },
        {
          orderNumber: 2,
          organizationId: orgA,
          supplierId: supplierA,
          createdById: userId,
          status: 'PARTIAL_RECEIVED',
          createdAt: beforeCutoff,
        },
        {
          orderNumber: 3,
          organizationId: orgA,
          supplierId: supplierA,
          createdById: userId,
          status: 'DRAFT',
          createdAt: beforeCutoff,
        },
        {
          orderNumber: 4,
          organizationId: orgA,
          supplierId: supplierB,
          createdById: userId,
          status: 'PENDING',
          createdAt: beforeCutoff,
        },
        {
          orderNumber: 1,
          organizationId: orgB,
          supplierId: supplierB,
          createdById: userB,
          status: 'PENDING',
          createdAt: beforeCutoff,
        },
      ],
    });
    const overdue = randomUUID();
    await db.moneyLoan.createMany({
      data: [
        {
          id: overdue,
          organizationId: orgA,
          customerId: customerA,
          createdById: userId,
          amount: 10,
          reason: 'overdue',
          issuedAt: date('2024-12-01'),
          dueAt: date('2024-12-31'),
          createdAt: beforeCutoff,
        },
        {
          organizationId: orgA,
          customerId: customerA,
          createdById: userId,
          amount: 10,
          reason: 'third day',
          issuedAt: date('2024-12-01'),
          dueAt: date('2025-01-04'),
          createdAt: beforeCutoff,
        },
        {
          organizationId: orgA,
          customerId: customerA,
          createdById: userId,
          amount: 10,
          reason: 'fourth day',
          issuedAt: date('2024-12-01'),
          dueAt: date('2025-01-05'),
          createdAt: beforeCutoff,
        },
        {
          organizationId: orgA,
          customerId: customerA,
          createdById: userId,
          amount: 10,
          status: 'CLOSED',
          reason: 'closed',
          issuedAt: date('2024-12-01'),
          dueAt: date('2025-01-01'),
          createdAt: beforeCutoff,
        },
        {
          organizationId: orgA,
          customerId: customerB,
          createdById: userId,
          amount: 10,
          reason: 'foreign customer',
          issuedAt: date('2024-12-01'),
          dueAt: date('2025-01-01'),
          createdAt: beforeCutoff,
        },
        {
          organizationId: orgB,
          customerId: customerB,
          createdById: userB,
          amount: 10,
          reason: 'foreign loan',
          issuedAt: date('2024-12-01'),
          dueAt: date('2025-01-01'),
          createdAt: beforeCutoff,
        },
      ],
    });
    await db.moneyLoanEvent.create({
      data: {
        organizationId: orgA,
        loanId: overdue,
        type: 'COLLECTED',
        amount: 3,
        method: 'CASH',
        reason: 'synthetic payment',
        createdById: userId,
        requestKey: 'synthetic',
        requestPayload: '{}',
        result: {},
        createdAt: beforeCutoff,
      },
    });
    controller = new DailyReportController(
      new DailyReportService(db as unknown as PrismaService),
    );
  }, 30000);

  afterAll(async () => {
    jest.useRealTimers();
    if (db) await db.$disconnect();
  });

  it('applies Bogotá cutoff, tenant boundaries, related-row safeguards and domain alerts', async () => {
    jest.useFakeTimers({
      now: cutoff,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
    const report = await controller.get({ organizationId: orgA } as never);
    expect(report.cutoff).toEqual(cutoff);
    expect(report.date).toBe('2025-01-01');
    expect(report.salesTotal).toBe('30.00');
    expect(report.sales.map((sale) => sale.saleNumber)).toEqual([1, 2]);
    expect(report.sales[0].customer?.name).toBe('Synthetic customer A');
    expect(report.sales[0].items[0]).toMatchObject({
      product: { name: 'Low A', sku: 'low-a' },
      quantity: 2,
      total: '10.00',
    });
    expect(report.sales[1].customer).toBeNull();
    expect(report.sales[1].items).toEqual([]);
    expect(report.expenseTotal).toBe('6.00');
    expect(report.expenses.map((expense) => expense.description)).toEqual([
      'date-only today',
      'timestamp start',
      'timestamp cutoff',
    ]);
    expect(report.lowStock.map((product) => product.name)).toEqual(['Low A']);
    expect(report.purchaseOrders.map((order) => order.orderNumber)).toEqual([
      1, 2,
    ]);
    expect(report.loans.map((loan) => loan.reason)).toEqual([
      'overdue',
      'foreign customer',
      'third day',
    ]);
    expect(
      report.loans.find((loan) => loan.reason === 'overdue')?.balance,
    ).toBe('7.00');
    expect(
      report.loans.find((loan) => loan.reason === 'foreign customer')?.customer,
    ).toBeNull();
    expect(JSON.stringify(report)).not.toContain('Synthetic secret B');
    expect(JSON.stringify(report)).not.toContain('Secret low B');
    const other = await controller.get({ organizationId: orgB } as never);
    expect(other.salesTotal).toBe('70.00');
    expect(other.sales[0].customer?.name).toBe('Synthetic secret B');
    expect(other.lowStock.map((product) => product.name)).toEqual([
      'Secret low B',
    ]);
    expect(other.loans.map((loan) => loan.reason)).toEqual(['foreign loan']);
    expect(JSON.stringify(other)).not.toContain('Synthetic customer A');
    jest.useRealTimers();
  }, 30000);

  it('switches expense and loan calendar boundaries at Bogotá midnight', async () => {
    jest.useFakeTimers({
      now: new Date('2025-01-02T05:00:00.000Z'),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
    const report = await controller.get({ organizationId: orgA } as never);
    expect(report.date).toBe('2025-01-02');
    expect(report.sales).toEqual([]);
    expect(report.expenses.map((expense) => expense.description)).toEqual([
      'date-only tomorrow',
    ]);
    expect(report.expenseTotal).toBe('80.00');
    expect(report.loans.map((loan) => loan.reason)).toEqual([
      'overdue',
      'foreign customer',
      'third day',
      'fourth day',
    ]);
    jest.useRealTimers();
  }, 30000);
});
