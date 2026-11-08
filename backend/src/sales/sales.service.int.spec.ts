import { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SequenceService } from '../common/sequences/sequence.service';
import { CacheService } from '../common/services/cache.service';
import { SettingsService } from '../settings/settings.service';
import { ReceiptsService } from '../receipts/receipts.service';
import {
  setupTwoOrgFixture,
  type TwoOrgFixture,
} from '../testing/two-org-fixture';

const cloudinaryServiceMock = {
  uploadImage: jest.fn(),
};

describe('SalesService — Integration (Numbering + Isolation)', () => {
  let prisma: TwoOrgFixture['prisma'];
  let fixture: TwoOrgFixture;
  let salesService: SalesService;
  let productId: string;
  let customerId: string;
  let productBOrgId: string;
  let customerBOrgId: string;
  let saleBOrgId: string;

  const buildSaleDto = (productId: string, customerId: string) => ({
    customerId,
    items: [{ productId, quantity: 1 }],
    payments: [{ method: 'CASH' as const, amount: 1190 }],
  });

  beforeAll(async () => {
    fixture = await setupTwoOrgFixture('sales-int');
    prisma = fixture.prisma;

    const settingsService = new SettingsService(
      prisma as never,
      cloudinaryServiceMock as never,
    );
    const cacheService = new CacheService();
    const sequenceService = new SequenceService();

    salesService = new SalesService(
      prisma as never,
      cacheService,
      settingsService,
      sequenceService,
      new ReceiptsService(),
    );

    const year = new Date().getFullYear();
    const [categoryA, categoryB] = await Promise.all([
      prisma.category.create({
        data: {
          name: 'Sales INT Cat',
          organizationId: fixture.orgAId,
          active: true,
        },
      }),
      prisma.category.create({
        data: {
          name: 'Sales INT Cat B',
          organizationId: fixture.orgBId,
          active: true,
        },
      }),
    ]);

    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          name: 'Sales INT Product',
          sku: 'SALES-SKU-' + Date.now(),
          salePrice: new Prisma.Decimal(1000),
          costPrice: new Prisma.Decimal(500),
          taxRate: new Prisma.Decimal(19),
          stock: 100,
          minStock: 1,
          active: true,
          categoryId: categoryA.id,
          organizationId: fixture.orgAId,
        },
      }),
      prisma.product.create({
        data: {
          name: 'Sales INT Product B',
          sku: 'SALES-SKU-B-' + Date.now(),
          salePrice: new Prisma.Decimal(1000),
          costPrice: new Prisma.Decimal(500),
          taxRate: new Prisma.Decimal(19),
          stock: 100,
          minStock: 1,
          active: true,
          categoryId: categoryB.id,
          organizationId: fixture.orgBId,
        },
      }),
    ]);
    productId = productA.id;
    productBOrgId = productB.id;

    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          name: 'Sales INT Customer',
          documentType: 'CC',
          documentNumber: '12345678',
          organizationId: fixture.orgAId,
          active: true,
        },
      }),
      prisma.customer.create({
        data: {
          name: 'Sales INT Customer B',
          documentType: 'CC',
          documentNumber: '87654321',
          organizationId: fixture.orgBId,
          active: true,
        },
      }),
    ]);
    customerId = customerA.id;
    customerBOrgId = customerB.id;

    await prisma.organizationSequence.createMany({
      data: [
        {
          organizationId: fixture.orgAId,
          type: 'SALE',
          prefix: 'REC',
          currentNumber: 0,
          year,
        },
        {
          organizationId: fixture.orgBId,
          type: 'SALE',
          prefix: 'RECB',
          currentNumber: 0,
          year,
        },
      ],
    });

    const saleB = await salesService.create(
      buildSaleDto(productBOrgId, customerBOrgId),
      fixture.userBId,
      fixture.orgBId,
    );
    saleBOrgId = saleB.id;
  });

  afterAll(() =>
    fixture.teardown(async () => {
      await prisma.saleItem.deleteMany({
        where: {
          sale: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
        },
      });
      await prisma.payment.deleteMany({
        where: {
          sale: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
        },
      });
      await prisma.sale.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
      await prisma.inventoryMovement.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
      await prisma.product.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
      await prisma.category.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
      await prisma.customer.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
      await prisma.organizationSequence.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
    }),
  );

  it('should assign consecutive saleNumbers for two sales in the same org', async () => {
    const dto1 = buildSaleDto(productId, customerId);
    const dto2 = buildSaleDto(productId, customerId);

    const sale1 = await salesService.create(
      dto1,
      fixture.userAId,
      fixture.orgAId,
    );
    const sale2 = await salesService.create(
      dto2,
      fixture.userAId,
      fixture.orgAId,
    );

    expect(sale1.saleNumber).toBe(1);
    expect(sale2.saleNumber).toBe(2);
  });

  it('cross-org detail read returns 404 and leaks no foreign data', async () => {
    await expect(
      salesService.findOne(saleBOrgId, fixture.orgAId),
    ).rejects.toThrow(NotFoundException);
    await expect(
      salesService.findOne(saleBOrgId, fixture.orgAId),
    ).rejects.toThrow('Sale not found');
  });

  it('list returns zero foreign-org rows under filters and pagination', async () => {
    const listA = await salesService.findAll(fixture.orgAId, 1, 10);
    expect(
      listA.data.every((sale) => sale.organizationId === fixture.orgAId),
    ).toBe(true);
    expect(listA.data.some((sale) => sale.id === saleBOrgId)).toBe(false);

    const listB = await salesService.findAll(fixture.orgBId, 1, 10);
    expect(listB.data.map((sale) => sale.id)).toEqual([saleBOrgId]);

    const searched = await salesService.findAll(
      fixture.orgAId,
      1,
      10,
      undefined,
      undefined,
      undefined,
      'Sales INT Customer B',
    );
    expect(searched.data).toHaveLength(0);
    expect(searched.meta.total).toBe(0);

    const paged = await salesService.findAll(fixture.orgBId, 2, 10);
    expect(paged.data).toHaveLength(0);
  });

  it('cross-org update is denied and the foreign row stays unchanged', async () => {
    const before = await prisma.sale.findUniqueOrThrow({
      where: { id: saleBOrgId },
    });

    await expect(
      salesService.update(
        saleBOrgId,
        { status: 'CANCELLED', cancelReason: 'cross-org try' },
        fixture.userAId,
        fixture.orgAId,
      ),
    ).rejects.toThrow(NotFoundException);

    const after = await prisma.sale.findUniqueOrThrow({
      where: { id: saleBOrgId },
    });
    expect(after.status).toBe('COMPLETED');
    expect(after.cancelReason).toBeNull();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  // T4b: the per-line fiscal facts must survive the transaction and the database,
  // because the CUFE and the XML read the persisted rows, never the catalog.
  it('persists the resolved tax code and tax amount per line', async () => {
    const category = await prisma.category.create({
      data: {
        name: 'Sales INT INC Cat',
        organizationId: fixture.orgAId,
        active: true,
      },
    });
    const incProduct = await prisma.product.create({
      data: {
        name: 'Sales INT INC Product',
        sku: 'SALES-SKU-INC-' + Date.now(),
        salePrice: new Prisma.Decimal(1000),
        costPrice: new Prisma.Decimal(500),
        taxRate: new Prisma.Decimal(5),
        taxCode: 'INC',
        taxable: true,
        stock: 10,
        minStock: 1,
        active: true,
        categoryId: category.id,
        organizationId: fixture.orgAId,
      },
    });

    const sale = await salesService.create(
      {
        customerId,
        items: [
          { productId: incProduct.id, quantity: 1 },
          // Untaxed line: `taxable` defaults to false, so it resolves no tax.
          { productId, quantity: 1 },
        ],
        payments: [{ method: 'CASH' as const, amount: 2100 }],
      },
      fixture.userAId,
      fixture.orgAId,
    );

    const rows = await prisma.saleItem.findMany({
      where: { saleId: sale.id },
      select: {
        productId: true,
        taxCode: true,
        taxAmount: true,
        taxRate: true,
      },
    });
    expect(rows).toHaveLength(2);

    const taxed = rows.find((row) => row.productId === incProduct.id);
    expect(taxed?.taxCode).toBe('INC');
    expect(Number(taxed?.taxAmount)).toBe(50);

    const untaxed = rows.find((row) => row.productId === productId);
    // No code and no amount: a code may never accompany a zero amount.
    expect(untaxed?.taxCode).toBeNull();
    expect(untaxed?.taxAmount).toBeNull();
  });

  it('leaves a pre-feature sale row NULL instead of backfilling it', async () => {
    // Spec S7: rows written before the feature are never reclassified, so the
    // columns must be nullable and must stay NULL when nothing sets them.
    const sale = await salesService.create(
      buildSaleDto(productId, customerId),
      fixture.userAId,
      fixture.orgAId,
    );
    const legacy = await prisma.saleItem.create({
      data: {
        saleId: sale.id,
        productId,
        quantity: 1,
        unitPrice: new Prisma.Decimal(1000),
        costPriceSnapshot: new Prisma.Decimal(500),
        taxRate: new Prisma.Decimal(19),
        discountAmount: new Prisma.Decimal(0),
        subtotal: new Prisma.Decimal(1000),
        total: new Prisma.Decimal(1190),
        organizationId: fixture.orgAId,
      },
      select: { taxCode: true, taxAmount: true },
    });

    expect(legacy.taxCode).toBeNull();
    expect(legacy.taxAmount).toBeNull();
  });
});
