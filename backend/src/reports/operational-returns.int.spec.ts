/**
 * S5.5 — the operational sales reports have to net a partially returned sale.
 *
 * Economía nets a return through its own event until it reaches zero. The
 * operational reports (top products, sales by category, customers, payment
 * methods) filtered `status: 'COMPLETED'` instead, so a `RETURNED_PARTIAL` sale
 * vanished from them completely even when the customer kept — and paid for — most
 * of it. These integration tests run the real queries against the migrated
 * database and assert the money the reports return.
 */
import { CacheService } from '../common/services/cache.service';
import { ReportsService } from './reports.service';
import { setupTwoOrgFixture, type TwoOrgFixture } from '../testing/two-org-fixture';

const PERIOD = { startDate: '2026-08-01', endDate: '2026-08-31' };
const SALE_CREATED = new Date('2026-08-10T15:00:00.000Z');
const RETURN_CREATED = new Date('2026-08-12T15:00:00.000Z');
const COMPLETED_CREATED = new Date('2026-08-15T15:00:00.000Z');

describe('Operational sales reports net partial returns (S5.5)', () => {
  let fixture: TwoOrgFixture;
  let orgId: string;
  let userId: string;
  let service: ReportsService;
  let partialProductId: string;
  let completedProductId: string;
  let snacksCategoryId: string;
  let partialCustomerId: string;
  let completedCustomerId: string;

  beforeAll(async () => {
    fixture = await setupTwoOrgFixture('reports-operational-returns');
    orgId = fixture.orgAId;
    userId = fixture.userAId;
    service = new ReportsService(fixture.prisma as never, new CacheService());

    const prisma = fixture.prisma;
    const [drinks, snacks] = await Promise.all([
      prisma.category.create({
        data: { name: 'S5.5 Bebidas', organizationId: orgId },
      }),
      prisma.category.create({
        data: { name: 'S5.5 Snacks', organizationId: orgId },
      }),
    ]);
    const [partialProduct, completedProduct] = await Promise.all([
      prisma.product.create({
        data: {
          name: 'S5.5 Jugo',
          sku: 'S55-JUGO',
          costPrice: 40,
          salePrice: 100,
          stock: 100,
          categoryId: drinks.id,
          organizationId: orgId,
        },
      }),
      prisma.product.create({
        data: {
          name: 'S5.5 Galleta',
          sku: 'S55-GALLETA',
          costPrice: 10,
          salePrice: 100,
          stock: 100,
          categoryId: snacks.id,
          organizationId: orgId,
        },
      }),
    ]);
    partialProductId = partialProduct.id;
    completedProductId = completedProduct.id;
    snacksCategoryId = snacks.id;

    const [partialCustomer, completedCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          name: 'S5.5 Cliente parcial',
          documentType: 'CC',
          documentNumber: '55555555',
          organizationId: orgId,
        },
      }),
      prisma.customer.create({
        data: {
          name: 'S5.5 Cliente completo',
          documentType: 'CC',
          documentNumber: '66666666',
          organizationId: orgId,
        },
      }),
    ]);
    partialCustomerId = partialCustomer.id;
    completedCustomerId = completedCustomer.id;

    // Four units sold and one of them returned: the customer keeps and pays for
    // three.
    const partialSale = await prisma.sale.create({
      data: {
        saleNumber: 1,
        status: 'RETURNED_PARTIAL',
        createdAt: SALE_CREATED,
        subtotal: 400,
        taxAmount: 0,
        discountAmount: 0,
        total: 400,
        amountPaid: 400,
        customerId: partialCustomerId,
        userId,
        organizationId: orgId,
      },
    });
    const completedSale = await prisma.sale.create({
      data: {
        saleNumber: 2,
        status: 'COMPLETED',
        createdAt: COMPLETED_CREATED,
        subtotal: 200,
        taxAmount: 0,
        discountAmount: 0,
        total: 200,
        amountPaid: 200,
        customerId: completedCustomerId,
        userId,
        organizationId: orgId,
      },
    });

    await prisma.saleItem.createMany({
      data: [
        {
          saleId: partialSale.id,
          productId: partialProductId,
          organizationId: orgId,
          quantity: 4,
          unitPrice: 100,
          costPriceSnapshot: 40,
          taxRate: 0,
          subtotal: 400,
          total: 400,
        },
        {
          saleId: completedSale.id,
          productId: completedProductId,
          organizationId: orgId,
          quantity: 2,
          unitPrice: 100,
          costPriceSnapshot: 10,
          taxRate: 0,
          subtotal: 200,
          total: 200,
        },
      ],
    });

    await prisma.payment.createMany({
      data: [
        {
          saleId: partialSale.id,
          organizationId: orgId,
          method: 'CASH',
          amount: 400,
          createdAt: SALE_CREATED,
        },
        {
          saleId: completedSale.id,
          organizationId: orgId,
          method: 'CARD',
          amount: 200,
          createdAt: COMPLETED_CREATED,
        },
      ],
    });

    await prisma.inventoryMovement.createMany({
      data: [
        {
          productId: partialProductId,
          organizationId: orgId,
          type: 'SALE',
          quantity: -4,
          previousStock: 100,
          newStock: 96,
          reason: 'S5.5 sale',
          userId,
          saleId: partialSale.id,
          createdAt: SALE_CREATED,
        },
        {
          productId: partialProductId,
          organizationId: orgId,
          type: 'RETURN',
          quantity: 1,
          previousStock: 96,
          newStock: 97,
          reason: 'S5.5 partial return',
          userId,
          saleId: partialSale.id,
          createdAt: RETURN_CREATED,
        },
        {
          productId: completedProductId,
          organizationId: orgId,
          type: 'SALE',
          quantity: -2,
          previousStock: 100,
          newStock: 98,
          reason: 'S5.5 sale',
          userId,
          saleId: completedSale.id,
          createdAt: COMPLETED_CREATED,
        },
      ],
    });
  }, 30000);

  afterAll(async () => {
    const prisma = fixture.prisma;
    await prisma.inventoryMovement.deleteMany({ where: { organizationId: orgId } });
    await prisma.payment.deleteMany({ where: { organizationId: orgId } });
    await prisma.saleItem.deleteMany({ where: { organizationId: orgId } });
    await prisma.sale.deleteMany({ where: { organizationId: orgId } });
    await prisma.product.deleteMany({ where: { organizationId: orgId } });
    await prisma.customer.deleteMany({ where: { organizationId: orgId } });
    await prisma.category.deleteMany({ where: { organizationId: orgId } });
    await fixture.teardown();
  });

  it('counts the kept units of a partially returned sale in the top products', async () => {
    const report = await service.getTopSellingProducts(
      orgId,
      PERIOD.startDate,
      PERIOD.endDate,
    );

    expect(report.data).toEqual([
      expect.objectContaining({
        productId: partialProductId,
        quantity: 3,
        total: 300,
      }),
      // A completed sale keeps reporting exactly what it reported before.
      expect.objectContaining({
        productId: completedProductId,
        quantity: 2,
        total: 200,
      }),
    ]);
  });

  it('counts the kept amount in its category', async () => {
    const report = await service.getSalesByCategory(
      orgId,
      PERIOD.startDate,
      PERIOD.endDate,
    );

    expect(report.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'S5.5 Bebidas', total: 300, quantity: 3 }),
        expect.objectContaining({ category: 'S5.5 Snacks', total: 200, quantity: 2 }),
      ]),
    );
  });

  it('keeps the customer of a partially returned sale with the revenue the customer kept', async () => {
    const report = await service.getCustomerStatistics(
      orgId,
      PERIOD.startDate,
      PERIOD.endDate,
    );

    expect(report.topCustomers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerId: partialCustomerId,
          totalSales: 1,
          totalRevenue: 300,
        }),
        expect.objectContaining({
          customerId: completedCustomerId,
          totalSales: 1,
          totalRevenue: 200,
        }),
      ]),
    );
  });

  it('keeps the payment of a partially returned sale, which was really collected', async () => {
    const report = await service.getSalesByPaymentMethod(
      orgId,
      PERIOD.startDate,
      PERIOD.endDate,
    );

    expect(report.data).toEqual([
      { paymentMethod: 'CASH', total: 400, subtotal: 400, count: 1 },
      { paymentMethod: 'CARD', total: 200, subtotal: 200, count: 1 },
    ]);
  });

  it('nets a return registered inside the period even when the sale predates it', async () => {
    const prisma = fixture.prisma;
    // Economía dates a return by its own event, so a return this month against a
    // sale from last month lowers this month's product totals. The operational
    // reports follow the same rule.
    const oldSale = await prisma.sale.create({
      data: {
        saleNumber: 3,
        status: 'RETURNED_PARTIAL',
        createdAt: new Date('2026-07-20T15:00:00.000Z'),
        subtotal: 200,
        taxAmount: 0,
        discountAmount: 0,
        total: 200,
        amountPaid: 200,
        userId,
        organizationId: orgId,
      },
    });
    const returnedProduct = await prisma.product.create({
      data: {
        name: 'S5.5 Producto devuelto despues',
        sku: 'S55-OLD',
        costPrice: 10,
        salePrice: 100,
        stock: 100,
        categoryId: snacksCategoryId,
        organizationId: orgId,
      },
    });
    await prisma.saleItem.create({
      data: {
        saleId: oldSale.id,
        productId: returnedProduct.id,
        organizationId: orgId,
        quantity: 2,
        unitPrice: 100,
        costPriceSnapshot: 10,
        taxRate: 0,
        subtotal: 200,
        total: 200,
      },
    });
    await prisma.inventoryMovement.create({
      data: {
        productId: returnedProduct.id,
        organizationId: orgId,
        type: 'RETURN',
        quantity: 1,
        previousStock: 100,
        newStock: 101,
        reason: 'S5.5 return of an older sale',
        userId,
        saleId: oldSale.id,
        createdAt: new Date('2026-08-25T15:00:00.000Z'),
      },
    });

    const report = await service.getTopSellingProducts(
      orgId,
      PERIOD.startDate,
      PERIOD.endDate,
    );

    expect(
      report.data.find((entry) => entry.productId === returnedProduct.id),
    ).toEqual(expect.objectContaining({ quantity: -1, total: -100 }));
  });

  it('leaves a fully returned sale out of the ranking instead of showing an empty row', async () => {
    const prisma = fixture.prisma;
    const fullyReturnedProduct = await prisma.product.create({
      data: {
        name: 'S5.5 Producto devuelto entero',
        sku: 'S55-FULL',
        costPrice: 10,
        salePrice: 100,
        stock: 100,
        categoryId: snacksCategoryId,
        organizationId: orgId,
      },
    });
    const fullyReturned = await prisma.sale.create({
      data: {
        saleNumber: 4,
        status: 'RETURNED_PARTIAL',
        createdAt: new Date('2026-08-20T15:00:00.000Z'),
        subtotal: 100,
        taxAmount: 0,
        discountAmount: 0,
        total: 100,
        amountPaid: 100,
        userId,
        organizationId: orgId,
      },
    });
    await prisma.saleItem.create({
      data: {
        saleId: fullyReturned.id,
        productId: fullyReturnedProduct.id,
        organizationId: orgId,
        quantity: 1,
        unitPrice: 100,
        costPriceSnapshot: 10,
        taxRate: 0,
        subtotal: 100,
        total: 100,
      },
    });
    await prisma.inventoryMovement.create({
      data: {
        productId: fullyReturnedProduct.id,
        organizationId: orgId,
        type: 'RETURN',
        quantity: 1,
        previousStock: 100,
        newStock: 101,
        reason: 'S5.5 full return of the sold unit',
        userId,
        saleId: fullyReturned.id,
        createdAt: new Date('2026-08-21T15:00:00.000Z'),
      },
    });

    const report = await service.getTopSellingProducts(
      orgId,
      PERIOD.startDate,
      PERIOD.endDate,
    );

    expect(
      report.data.find((entry) => entry.productId === fullyReturnedProduct.id),
    ).toBeUndefined();
    // The untouched completed sale keeps reporting exactly what it reported
    // before this change.
    expect(
      report.data.find((entry) => entry.productId === completedProductId),
    ).toEqual(expect.objectContaining({ quantity: 2, total: 200 }));
  });
});
