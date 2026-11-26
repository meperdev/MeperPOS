import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { CacheService } from '../common/services/cache.service';
import { ReportsService } from './reports.service';

// Opt-in only: never fall back to DATABASE_URL, load an env file, or clean up
// an unrelated database. The dedicated database is cloned from the full
// migration chain before the run.
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
    !/^\/meperpos_stock_rehearsal_t26_[a-z0-9]+$/.test(url.pathname) ||
    !safeParameters
  ) {
    throw new Error(
      'TEST_DATABASE_URL must identify the dedicated local test database',
    );
  }
  databaseName = url.pathname.slice(1);
}

const describePostgres = testUrl ? describe : describe.skip;

const START = '2026-03-01';
const END = '2026-03-31';

describePostgres('Reports site filter on PostgreSQL', () => {
  let db: PrismaClient;
  let service: ReportsService;

  const runId = randomUUID();
  const suffix = runId.slice(0, 8);
  const organizationId = randomUUID();
  const sellerA = randomUUID();
  const sellerB = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();
  const categoryA = randomUUID();
  const categoryB = randomUUID();
  const productA = randomUUID();
  const productB = randomUUID();
  const saleA = randomUUID();
  const saleB = randomUUID();
  const legacySale = randomUUID();
  const movementA = randomUUID();
  const legacyMovement = randomUUID();
  let siteA = '';
  let siteB = '';

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

    service = new ReportsService(db as never, new CacheService());

    await db.organization.create({
      data: {
        id: organizationId,
        name: `Site filter ${suffix}`,
        slug: `site-filter-${runId}`,
      },
    });
    const defaultSite = await db.location.create({
      data: {
        organizationId,
        name: 'Sede principal',
        type: 'STORE',
        isDefault: true,
      },
      select: { id: true },
    });
    siteA = defaultSite.id;
    const secondSite = await db.location.create({
      data: {
        organizationId,
        name: 'Sucursal B',
        type: 'STORE',
        isDefault: false,
      },
      select: { id: true },
    });
    siteB = secondSite.id;

    await db.user.createMany({
      data: [
        {
          id: sellerA,
          email: `site-seller-a-${runId}@example.invalid`,
          password: 'not-a-login',
          name: 'Seller A',
        },
        {
          id: sellerB,
          email: `site-seller-b-${runId}@example.invalid`,
          password: 'not-a-login',
          name: 'Seller B',
        },
      ],
    });
    await db.organizationUser.createMany({
      data: [
        { organizationId, userId: sellerA, role: 'ADMIN' },
        { organizationId, userId: sellerB, role: 'ADMIN' },
      ],
    });
    await db.customer.createMany({
      data: [
        {
          id: customerA,
          name: 'Customer A',
          documentType: 'CC',
          documentNumber: `a-${suffix}`,
          organizationId,
        },
        {
          id: customerB,
          name: 'Customer B',
          documentType: 'CC',
          documentNumber: `b-${suffix}`,
          organizationId,
        },
      ],
    });
    await db.category.createMany({
      data: [
        { id: categoryA, name: 'Category A', organizationId },
        { id: categoryB, name: 'Category B', organizationId },
      ],
    });
    await db.product.createMany({
      data: [
        {
          id: productA,
          name: 'Product A',
          sku: `site-a-${suffix}`,
          categoryId: categoryA,
          organizationId,
          costPrice: 40,
          salePrice: 100,
        },
        {
          id: productB,
          name: 'Product B',
          sku: `site-b-${suffix}`,
          categoryId: categoryB,
          organizationId,
          costPrice: 10,
          salePrice: 50,
        },
      ],
    });
    // Every product opens its principal-site row on insert; the rest of the
    // balances move through the site ledger, never through the aggregate.
    await db.productStock.update({
      where: {
        productId_locationId: { productId: productA, locationId: siteA },
      },
      data: { stock: 5 },
    });
    await db.productStock.create({
      data: {
        productId: productA,
        locationId: siteB,
        organizationId,
        stock: 2,
        reservedStock: 0,
      },
    });
    await db.productStock.update({
      where: {
        productId_locationId: { productId: productB, locationId: siteA },
      },
      data: { stock: 3 },
    });

    const saleNumbers = { a: 910001, b: 910002, legacy: 910003 };
    await db.sale.create({
      data: {
        id: saleA,
        saleNumber: saleNumbers.a,
        organizationId,
        userId: sellerA,
        customerId: customerA,
        createdAt: new Date('2026-03-10T15:00:00.000Z'),
        subtotal: 100,
        taxAmount: 19,
        discountAmount: 0,
        total: 119,
        amountPaid: 119,
        status: 'COMPLETED',
      },
    });
    await db.sale.create({
      data: {
        id: saleB,
        saleNumber: saleNumbers.b,
        organizationId,
        userId: sellerB,
        customerId: customerB,
        createdAt: new Date('2026-03-11T15:00:00.000Z'),
        subtotal: 50,
        taxAmount: 0,
        discountAmount: 0,
        total: 50,
        amountPaid: 50,
        status: 'COMPLETED',
      },
    });
    // Recorded before site attribution: it belongs to no site view.
    await db.sale.create({
      data: {
        id: legacySale,
        saleNumber: saleNumbers.legacy,
        organizationId,
        userId: sellerB,
        createdAt: new Date('2026-03-12T15:00:00.000Z'),
        subtotal: 50,
        taxAmount: 0,
        discountAmount: 0,
        total: 50,
        amountPaid: 50,
        status: 'COMPLETED',
      },
    });
    await db.saleOriginSite.createMany({
      data: [
        { saleId: saleA, organizationId, locationId: siteA },
        { saleId: saleB, organizationId, locationId: siteB },
      ],
    });
    await db.saleItem.createMany({
      data: [
        {
          saleId: saleA,
          productId: productA,
          quantity: 2,
          unitPrice: 50,
          costPriceSnapshot: 40,
          taxRate: 19,
          subtotal: 100,
          total: 119,
          organizationId,
        },
        {
          saleId: saleB,
          productId: productB,
          quantity: 1,
          unitPrice: 50,
          costPriceSnapshot: 10,
          taxRate: 0,
          subtotal: 50,
          total: 50,
          organizationId,
        },
        {
          saleId: legacySale,
          productId: productB,
          quantity: 1,
          unitPrice: 50,
          costPriceSnapshot: 10,
          taxRate: 0,
          subtotal: 50,
          total: 50,
          organizationId,
        },
      ],
    });
    await db.payment.createMany({
      data: [
        {
          saleId: saleA,
          organizationId,
          method: 'CASH',
          amount: 119,
          createdAt: new Date('2026-03-10T15:00:00.000Z'),
        },
        {
          saleId: saleB,
          organizationId,
          method: 'CARD',
          amount: 50,
          createdAt: new Date('2026-03-11T15:00:00.000Z'),
        },
        {
          saleId: legacySale,
          organizationId,
          method: 'CASH',
          amount: 50,
          createdAt: new Date('2026-03-12T15:00:00.000Z'),
        },
      ],
    });
    await db.inventoryMovement.createMany({
      data: [
        {
          id: movementA,
          productId: productA,
          organizationId,
          type: 'ADJUSTMENT_IN',
          quantity: 5,
          previousStock: 0,
          newStock: 5,
          reason: 'Synthetic site movement',
          userId: sellerA,
          locationId: siteA,
          createdAt: new Date('2026-03-10T14:00:00.000Z'),
        },
        {
          id: legacyMovement,
          productId: productB,
          organizationId,
          type: 'ADJUSTMENT_IN',
          quantity: 1,
          previousStock: 2,
          newStock: 3,
          reason: 'Synthetic unattributed movement',
          userId: sellerB,
          createdAt: new Date('2026-03-10T14:00:00.000Z'),
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await db.saleOriginSite.deleteMany({ where: { organizationId } });
    await db.payment.deleteMany({ where: { organizationId } });
    await db.saleItem.deleteMany({ where: { organizationId } });
    await db.inventoryMovement.deleteMany({
      where: { id: { in: [movementA, legacyMovement] } },
    });
    await db.sale.deleteMany({ where: { organizationId } });
    await db.product.deleteMany({ where: { organizationId } });
    await db.category.deleteMany({ where: { organizationId } });
    await db.customer.deleteMany({ where: { organizationId } });
    await db.organizationUser.deleteMany({ where: { organizationId } });
    await db.location.deleteMany({ where: { organizationId } });
    await db.user.deleteMany({ where: { id: { in: [sellerA, sellerB] } } });
    await db.organization.delete({ where: { id: organizationId } });
    await db.$disconnect();
  }, 60_000);

  it('adds up only the requested site and keeps the unattributed sale out', async () => {
    const unfiltered = await service.getDailySales(organizationId, START, END);
    const siteOnly = await service.getDailySales(
      organizationId,
      START,
      END,
      siteA,
    );

    expect(unfiltered.data).toEqual([
      { date: '2026-03-10', total: 119, subtotal: 100, tax: 19, count: 1 },
      { date: '2026-03-11', total: 50, subtotal: 50, tax: 0, count: 1 },
      { date: '2026-03-12', total: 50, subtotal: 50, tax: 0, count: 1 },
    ]);
    expect(siteOnly.data).toEqual([
      { date: '2026-03-10', total: 119, subtotal: 100, tax: 19, count: 1 },
    ]);
  });

  it('isolates categories, top products and payment methods per site', async () => {
    const categories = await service.getSalesByCategory(
      organizationId,
      START,
      END,
      siteA,
    );
    const topProducts = await service.getTopSellingProducts(
      organizationId,
      START,
      END,
      10,
      siteA,
    );
    const payments = await service.getSalesByPaymentMethod(
      organizationId,
      START,
      END,
      siteA,
    );

    expect(categories.data).toEqual([
      { category: 'Category A', total: 119, quantity: 2 },
    ]);
    expect(topProducts.data.map((row) => row.productId)).toEqual([productA]);
    expect(topProducts.data[0].quantity).toBe(2);
    expect(payments.data).toEqual([
      { paymentMethod: 'CASH', total: 119, subtotal: 119, count: 1 },
    ]);

    const allPayments = await service.getSalesByPaymentMethod(
      organizationId,
      START,
      END,
    );
    expect(allPayments.data).toEqual([
      { paymentMethod: 'CASH', total: 169, subtotal: 169, count: 2 },
      { paymentMethod: 'CARD', total: 50, subtotal: 50, count: 1 },
    ]);
  });

  it('ranks the site customers and sellers without the unattributed sale', async () => {
    const customers = await service.getCustomerStatistics(
      organizationId,
      START,
      END,
      siteA,
    );
    const sellers = await service.getUserPerformance(
      organizationId,
      START,
      END,
      false,
      undefined,
      siteA,
    );

    expect(customers.topCustomers).toEqual([
      {
        customerId: customerA,
        customerName: 'Customer A',
        totalSales: 1,
        totalRevenue: 119,
      },
    ]);
    expect(sellers.data).toEqual([
      {
        userId: sellerA,
        userName: 'Seller A',
        salesCount: 1,
        revenue: 119,
        avgTicket: 119,
        uniqueCustomers: 1,
      },
    ]);

    const allCustomers = await service.getCustomerStatistics(
      organizationId,
      START,
      END,
    );
    expect(allCustomers.topCustomers.map((row) => row.customerId)).toEqual([
      customerA,
      customerB,
    ]);
  });

  it('scopes the dashboard sales figures while the catalog counters stay organization-wide', async () => {
    const siteDashboard = await service.getDashboardKPIs(
      organizationId,
      START,
      END,
      siteA,
    );
    const orgDashboard = await service.getDashboardKPIs(
      organizationId,
      START,
      END,
    );

    expect(siteDashboard.totalSales).toBe(1);
    expect(siteDashboard.totalRevenue).toBe(119);
    expect(siteDashboard.recentSales.map((sale) => sale.id)).toEqual([saleA]);
    expect(siteDashboard.totalProducts).toBe(orgDashboard.totalProducts);
    expect(siteDashboard.totalCustomers).toBe(orgDashboard.totalCustomers);

    expect(orgDashboard.totalSales).toBe(3);
    expect(orgDashboard.totalRevenue).toBe(219);
  });

  it('values the stock of the requested site and its own movements', async () => {
    const siteAInventory = await service.getInventorySnapshot(
      organizationId,
      START,
      END,
      siteA,
    );
    const siteBInventory = await service.getInventorySnapshot(
      organizationId,
      START,
      END,
      siteB,
    );
    const orgInventory = await service.getInventorySnapshot(
      organizationId,
      START,
      END,
    );

    expect(siteAInventory.current).toEqual({
      stockQuantity: 8,
      stockValue: '230.00',
      retailValue: '650.00',
      potentialProfit: '420.00',
    });
    expect(siteAInventory.movements.totalQuantity).toBe(5);

    expect(siteBInventory.current).toEqual({
      stockQuantity: 2,
      stockValue: '80.00',
      retailValue: '200.00',
      potentialProfit: '120.00',
    });
    expect(siteBInventory.movements.totalQuantity).toBe(0);

    expect(orgInventory.current.stockQuantity).toBe(10);
    expect(orgInventory.current.stockValue).toBe('310.00');
    expect(orgInventory.movements.totalQuantity).toBe(6);
  });
});
