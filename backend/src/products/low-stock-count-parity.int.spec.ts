import { Prisma, ProductType } from '@prisma/client';
import { ProductsService } from './products.service';
import { ReportsService } from '../reports/reports.service';
import { CacheService } from '../common/services/cache.service';
import {
  setupTwoOrgFixture,
  type TwoOrgFixture,
} from '../testing/two-org-fixture';

/**
 * The inventory badge, the low-stock list it opens and the dashboard KPI answer the
 * same question three different ways: a paginated Prisma COUNT, a raw-SQL row read and
 * a raw-SQL COUNT. They used to disagree — the badge counted only the ten rows of the
 * current page. This spec pins the three surfaces to one number against a real
 * PostgreSQL, so no future predicate edit can move one without the others.
 */
describe('ProductsService — low-stock count parity (integration)', () => {
  const LOW_STOCK_TOTAL = 12;
  let fixture: TwoOrgFixture;
  let prisma: TwoOrgFixture['prisma'];
  let productsService: ProductsService;
  let reportsService: ReportsService;
  let categoryAId: string;

  beforeAll(async () => {
    fixture = await setupTwoOrgFixture('low-stock-parity');
    prisma = fixture.prisma;
    productsService = new ProductsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    reportsService = new ReportsService(prisma as never, new CacheService());

    const categoryA = await prisma.category.create({
      data: {
        name: 'Parity Categoría A',
        organizationId: fixture.orgAId,
        active: true,
      },
    });
    categoryAId = categoryA.id;

    const unique = Date.now();
    const merchandise = (
      index: number,
      overrides: Record<string, unknown>,
    ) => ({
      name: `Parity low ${index}`,
      sku: `PARITY-${unique}-${index}`,
      salePrice: new Prisma.Decimal(1000),
      costPrice: new Prisma.Decimal(500),
      stock: 1,
      minStock: 5,
      type: ProductType.PRODUCT,
      tracksStock: true,
      active: true,
      categoryId: categoryAId,
      organizationId: fixture.orgAId,
      ...overrides,
    });

    await prisma.product.createMany({
      data: [
        // The real low-stock set: tracked merchandise at or below its minimum.
        ...Array.from({ length: LOW_STOCK_TOTAL }, (_, index) =>
          merchandise(index, {}),
        ),
        // Same numbers, but untracked: never low on stock.
        merchandise(100, { tracksStock: false, stock: 0 }),
        // A service with qualifying numbers is still not merchandise.
        merchandise(101, {
          type: ProductType.SERVICE,
          tracksStock: false,
          stock: 0,
        }),
        // Healthy stock.
        merchandise(102, { stock: 50 }),
        // Inactive merchandise belongs only to an explicit inactive view.
        merchandise(103, { active: false }),
      ],
    });
  });

  afterAll(() =>
    fixture.teardown(async () => {
      await prisma.product.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
      await prisma.category.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
    }),
  );

  it('serves the catalog-wide count on an unfiltered, paginated page', async () => {
    const page = await productsService.findAll(
      fixture.orgAId,
      1,
      5,
      undefined,
      undefined,
      'active',
      false,
      'name',
    );

    // Five rows on screen, twelve low on stock in the catalog.
    expect(page.data).toHaveLength(5);
    expect(page.meta.total).toBe(LOW_STOCK_TOTAL + 3);
    expect(page.meta.lowStockCount).toBe(LOW_STOCK_TOTAL);
  });

  it('reports the same total whether the low-stock filter is on or off', async () => {
    const filtered = await productsService.findAll(
      fixture.orgAId,
      1,
      5,
      undefined,
      undefined,
      'active',
      true,
      'name',
    );

    expect(filtered.meta.total).toBe(LOW_STOCK_TOTAL);
    expect(filtered.meta.lowStockCount).toBe(LOW_STOCK_TOTAL);
    expect(filtered.data.every((product) => product.isLowStock)).toBe(true);
  });

  it('scopes the count by status instead of ignoring the surrounding filters', async () => {
    const inactive = await productsService.findAll(
      fixture.orgAId,
      1,
      5,
      undefined,
      undefined,
      'inactive',
      false,
      'name',
    );

    // Only the one inactive product qualifies, and it is low on stock.
    expect(inactive.meta.total).toBe(1);
    expect(inactive.meta.lowStockCount).toBe(1);
  });

  it('agrees with the dedicated low-stock endpoint and the dashboard KPI', async () => {
    const [list, lowStockRows, dashboard] = await Promise.all([
      productsService.findAll(
        fixture.orgAId,
        1,
        5,
        undefined,
        undefined,
        'active',
        false,
        'name',
      ),
      productsService.getLowStockProducts(fixture.orgAId),
      reportsService.getDashboardKPIs(fixture.orgAId),
    ]);

    expect(list.meta.lowStockCount).toBe(LOW_STOCK_TOTAL);
    expect(lowStockRows).toHaveLength(LOW_STOCK_TOTAL);
    expect(dashboard.lowStockProducts).toBe(LOW_STOCK_TOTAL);
  });

  it('never leaks another organization into the badge total', async () => {
    const categoryB = await prisma.category.create({
      data: {
        name: 'Parity Categoría B',
        organizationId: fixture.orgBId,
        active: true,
      },
    });
    await prisma.product.create({
      data: {
        name: 'Parity low foreign',
        sku: `PARITY-foreign-${Date.now()}`,
        salePrice: new Prisma.Decimal(1000),
        costPrice: new Prisma.Decimal(500),
        stock: 1,
        minStock: 5,
        active: true,
        categoryId: categoryB.id,
        organizationId: fixture.orgBId,
      },
    });

    const page = await productsService.findAll(
      fixture.orgAId,
      1,
      5,
      undefined,
      undefined,
      'active',
      false,
      'name',
    );

    expect(page.meta.lowStockCount).toBe(LOW_STOCK_TOTAL);
  });
});
