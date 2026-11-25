import { FiscalDocumentStatus, OrgRole, Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SequenceService } from '../common/sequences/sequence.service';
import { CacheService } from '../common/services/cache.service';
import { SettingsService } from '../settings/settings.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { FiscalDocumentService } from '../electronic-invoicing/fiscal-document.service';
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
      // T4h: the fiscal document is preserved by the database on both sides
      // (`ON DELETE RESTRICT` for the organization and for the sale), so a
      // fixture that intends to remove its sales deletes exactly its own fiscal
      // records first. Nothing else in the chain may cascade them away.
      await prisma.fiscalDocument.deleteMany({
        where: { organizationId: { in: [fixture.orgAId, fixture.orgBId] } },
      });
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

  // T4c + spec S9 — «solo para quienes la tienen activa». Activation is the
  // backend-managed `settings.electronicInvoicing` system key, read inside the
  // sale transaction, so the two organizations in this fixture diverge on
  // purpose: org A is a pilot, org B is not.
  describe('fiscal document emission and lifecycle', () => {
    const enableElectronicInvoicing = (organizationId: string) =>
      prisma.organization.update({
        where: { id: organizationId },
        data: { settings: { electronicInvoicing: { enabled: true } } },
      });

    it('registers one PENDING fiscal document and reads it only inside its organization', async () => {
      await enableElectronicInvoicing(fixture.orgAId);

      const sale = await salesService.create(
        buildSaleDto(productId, customerId),
        fixture.userAId,
        fixture.orgAId,
      );

      const document = await prisma.fiscalDocument.findFirstOrThrow({
        where: { saleId: sale.id, organizationId: fixture.orgAId },
      });
      expect(document.status).toBe('PENDING');
      expect(document.cufe).toBeNull();
      expect(document.invoiceNumber).toBeNull();
      expect(document.issuedAt.getTime()).toBe(sale.createdAt.getTime());
      expect(document.snapshot).toMatchObject({
        version: 1,
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        organizationId: fixture.orgAId,
        currency: 'COP',
        payableAmount: sale.total.toFixed(2),
        lineExtensionAmount: sale.subtotal.toFixed(2),
      });

      const service = new FiscalDocumentService(prisma as never);
      await expect(
        service.findBySaleId(sale.id, fixture.orgAId),
      ).resolves.toMatchObject({ id: document.id });
      // Another organization never learns that the document exists.
      await expect(
        service.findBySaleId(sale.id, fixture.orgBId),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.transition(
          document.id,
          fixture.orgBId,
          FiscalDocumentStatus.SENT,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        await prisma.fiscalDocument.findFirstOrThrow({
          where: { id: document.id },
          select: { status: true },
        }),
      ).toEqual({ status: 'PENDING' });
    });

    it('registers no document for an organization that has not activated electronic invoicing', async () => {
      // Org B was never enabled, and its sale predates this test.
      expect(
        await prisma.fiscalDocument.findFirst({
          where: { saleId: saleBOrgId, organizationId: fixture.orgBId },
        }),
      ).toBeNull();

      const sale = await salesService.create(
        buildSaleDto(productBOrgId, customerBOrgId),
        fixture.userBId,
        fixture.orgBId,
      );
      expect(
        await prisma.fiscalDocument.findFirst({
          where: { saleId: sale.id, organizationId: fixture.orgBId },
        }),
      ).toBeNull();
    });

    it('rejects a document that points at another organization sale', async () => {
      // Org B is not activated, so its sale has no document yet and the unique
      // `saleId` guard cannot mask the foreign key: the pair (org A, sale of
      // org B) simply does not exist, so the database refuses it.
      expect(
        await prisma.fiscalDocument.findFirst({
          where: { saleId: saleBOrgId },
        }),
      ).toBeNull();

      await expect(
        prisma.fiscalDocument.create({
          data: {
            organizationId: fixture.orgAId,
            saleId: saleBOrgId,
            status: 'PENDING',
            issuedAt: new Date(),
            snapshot: { forged: true },
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('voids the pending document in the transaction that cancels the sale', async () => {
      await enableElectronicInvoicing(fixture.orgAId);
      const sale = await salesService.create(
        buildSaleDto(productId, customerId),
        fixture.userAId,
        fixture.orgAId,
      );

      await salesService.update(
        sale.id,
        { status: 'CANCELLED', cancelReason: 'Cliente desistió' },
        fixture.userAId,
        fixture.orgAId,
      );

      const document = await prisma.fiscalDocument.findFirstOrThrow({
        where: { saleId: sale.id, organizationId: fixture.orgAId },
      });
      expect(document.status).toBe('VOIDED');
      expect(document.resolvedAt).not.toBeNull();
    });

    it('refuses to cancel a sale whose fiscal document was already resolved', async () => {
      await enableElectronicInvoicing(fixture.orgAId);
      const sale = await salesService.create(
        buildSaleDto(productId, customerId),
        fixture.userAId,
        fixture.orgAId,
      );
      const document = await prisma.fiscalDocument.findFirstOrThrow({
        where: { saleId: sale.id, organizationId: fixture.orgAId },
      });
      await prisma.fiscalDocument.update({
        where: { id: document.id },
        data: { status: 'ACCEPTED', resolvedAt: new Date() },
      });

      await expect(
        salesService.update(
          sale.id,
          { status: 'CANCELLED' },
          fixture.userAId,
          fixture.orgAId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(
        await prisma.sale.findFirstOrThrow({
          where: { id: sale.id },
          select: { status: true },
        }),
      ).toEqual({ status: 'COMPLETED' });
      expect(
        await prisma.fiscalDocument.findFirstOrThrow({
          where: { id: document.id },
          select: { status: true },
        }),
      ).toEqual({ status: 'ACCEPTED' });
    });
  });

  // ---- FASE 7 commercial integrity (SEC-012, SEC-014, SEC-015) ----

  const createProduct = async (data: {
    name: string;
    stock: number;
    salePrice: number;
    taxable?: boolean;
    taxRate?: number;
  }) => {
    const category = await prisma.category.create({
      data: {
        name: `Sales INT ${data.name}`,
        organizationId: fixture.orgAId,
        active: true,
      },
    });
    return prisma.product.create({
      data: {
        name: data.name,
        sku: `SALES-INT-${data.name.replace(/\s+/g, '-')}-${Date.now()}`,
        salePrice: new Prisma.Decimal(data.salePrice),
        costPrice: new Prisma.Decimal(0),
        taxRate: new Prisma.Decimal(data.taxRate ?? 0),
        taxable: data.taxable ?? false,
        taxCode: data.taxable ? 'IVA' : null,
        stock: data.stock,
        minStock: 1,
        active: true,
        categoryId: category.id,
        organizationId: fixture.orgAId,
      },
    });
  };

  it('SEC-015: taxes the sale-wide discount base before per-line tax', async () => {
    const product = await createProduct({
      name: 'Discount Base',
      stock: 10,
      salePrice: 100,
      taxable: true,
      taxRate: 19,
    });

    const sale = await salesService.create(
      {
        customerId,
        items: [{ productId: product.id, quantity: 1 }],
        discountAmount: 20,
        payments: [{ method: 'CASH', amount: 95.2 }],
      },
      fixture.userAId,
      fixture.orgAId,
    );

    expect(Number(sale.subtotal)).toBe(100);
    expect(Number(sale.discountAmount)).toBe(20);
    // 80 taxable base × 19% = 15.20, not 19.00 on the undiscounted subtotal.
    expect(Number(sale.taxAmount)).toBe(15.2);
    expect(Number(sale.total)).toBe(95.2);

    const line = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: sale.id },
      select: { taxAmount: true, total: true },
    });
    expect(Number(line.taxAmount)).toBe(15.2);
    expect(Number(line.total)).toBe(95.2);
  });

  it('SEC-014: replays the sale registered for the same requestKey', async () => {
    const product = await createProduct({
      name: 'Idempotent',
      stock: 5,
      salePrice: 1000,
    });
    const dto = {
      customerId,
      items: [{ productId: product.id, quantity: 2 }],
      discountAmount: 0,
      payments: [{ method: 'CASH' as const, amount: 2000 }],
      requestKey: `idem-${Date.now()}-0001`,
    };

    const first = await salesService.create(
      dto,
      fixture.userAId,
      fixture.orgAId,
    );
    const second = await salesService.create(
      dto,
      fixture.userAId,
      fixture.orgAId,
    );

    expect(second.id).toBe(first.id);
    expect(second.saleNumber).toBe(first.saleNumber);
    expect(
      await prisma.sale.count({ where: { requestKeyHash: { not: null } } }),
    ).toBeGreaterThanOrEqual(1);
    expect(await prisma.saleItem.count({ where: { saleId: first.id } })).toBe(
      1,
    );
    const stock = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });
    // One sale, one stock decrement of two units.
    expect(stock.stock).toBe(3);

    const persisted = await prisma.sale.findUniqueOrThrow({
      where: { id: first.id },
      select: { requestKeyHash: true },
    });
    expect(persisted.requestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted.requestKeyHash).not.toContain(dto.requestKey);
  });

  it('SEC-012: answers 409, never 500, when concurrent sales race for the last unit', async () => {
    const product = await createProduct({
      name: 'Last Unit',
      stock: 1,
      salePrice: 1000,
    });
    const dto = {
      customerId,
      items: [{ productId: product.id, quantity: 1 }],
      payments: [{ method: 'CASH' as const, amount: 1000 }],
    };

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        salesService.create(dto, fixture.userAId, fixture.orgAId),
      ),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(ConflictException);
      expect((result.reason as Error).message).not.toMatch(/P20\d\d|P2034/);
    }
    expect(
      await prisma.saleItem.count({
        where: { productId: product.id },
      }),
    ).toBe(1);
    const stock = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });
    expect(stock.stock).toBe(0);
  });

  describe('direct POS origin before the stock cutover', () => {
    // T3a: creating the fixture products already opened their default-site rows,
    // so each tenant's sole principal site is the one that exists.
    let principal: string;
    const warehouse = 'sales-int-origin-warehouse';
    let outside: string;
    let actor: RequestUser;

    beforeAll(async () => {
      actor = {
        ...fixture.actAs('A'),
        email: 'sales-origin@example.test',
        role: OrgRole.ADMIN,
        tokenVersion: 0,
        isSuperAdmin: false,
      };
      await prisma.organizationUser.create({
        data: {
          userId: actor.userId,
          organizationId: actor.organizationId!,
          role: actor.role as OrgRole,
        },
      });
      const [principalSite, outsideSite] = await Promise.all([
        prisma.location.findFirstOrThrow({
          where: { organizationId: fixture.orgAId, isDefault: true },
          select: { id: true },
        }),
        prisma.location.findFirstOrThrow({
          where: { organizationId: fixture.orgBId, isDefault: true },
          select: { id: true },
        }),
      ]);
      principal = principalSite.id;
      outside = outsideSite.id;
    });

    const create = (locationId: string | undefined, requestKey: string) => {
      const dto = {
        ...buildSaleDto(productId, customerId),
        locationId,
        requestKey,
      };
      return salesService.create(
        dto,
        actor.userId,
        actor.organizationId,
        actor,
      );
    };
    const snapshot = async () => {
      const where = { organizationId: fixture.orgAId };
      return {
        sales: await prisma.sale.count({ where }),
        origins: await prisma.saleOriginSite.count({ where }),
        movements: await prisma.inventoryMovement.count({ where }),
        siteBalances: await prisma.productStock.count({ where }),
        siteLedger: await prisma.productStock.findMany({
          where: { productId, organizationId: fixture.orgAId },
          select: {
            productId: true,
            locationId: true,
            organizationId: true,
            stock: true,
            reservedStock: true,
          },
        }),
        product: await prisma.product.findUniqueOrThrow({
          where: { id: productId },
          select: { stock: true, reservedStock: true, version: true },
        }),
        counter: await prisma.organizationSequence.findFirstOrThrow({
          where: { ...where, type: 'SALE' },
          select: { currentNumber: true },
        }),
      };
    };

    it('preserves legacy replay without storing an origin site or accepting retroactive attribution', async () => {
      const legacy = await create(undefined, 'origin-legacy');
      const after = await snapshot();
      expect(after.origins).toBe(0);
      // T3b: no origin is stored, but the units still left the default site
      // that fulfilled the sale.
      expect(
        await prisma.inventoryMovement.findFirstOrThrow({
          where: { saleId: legacy.id },
          select: { locationId: true },
        }),
      ).toEqual({ locationId: principal });
      await expect(create(undefined, 'origin-legacy')).resolves.toMatchObject({
        id: legacy.id,
      });
      await expect(create(principal, 'origin-legacy')).rejects.toMatchObject({
        status: 409,
        message:
          'La solicitud ya corresponde a una venta con otra atribución de sede',
      });
      expect(await snapshot()).toEqual(after);
    });

    it('persists the authorized principal and moves its site balance on sale and reversal', async () => {
      const before = await snapshot();
      await expect(create(outside, 'origin-foreign')).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });
      expect(await snapshot()).toEqual(before);

      const sale = await create(principal, 'origin-new-sale');
      expect(sale).not.toHaveProperty('originSite');
      expect(
        await prisma.saleOriginSite.findFirstOrThrow({
          where: { saleId: sale.id },
        }),
      ).toEqual({
        saleId: sale.id,
        organizationId: fixture.orgAId,
        locationId: principal,
      });
      expect(await snapshot()).toEqual({
        ...before,
        sales: before.sales + 1,
        origins: before.origins + 1,
        movements: before.movements + 1,
        // T3b: the sale left the site that fulfilled it, and `Product` still
        // reports the organization aggregate the trigger derives from it.
        siteLedger: before.siteLedger.map((row) => ({
          ...row,
          stock: row.stock - 1,
        })),
        product: {
          ...before.product,
          stock: before.product.stock - 1,
          version: before.product.version + 1,
        },
        counter: { currentNumber: before.counter.currentNumber + 1 },
      });
      const after = await snapshot();
      await expect(create(principal, 'origin-new-sale')).resolves.toMatchObject(
        { id: sale.id },
      );
      await expect(create(undefined, 'origin-new-sale')).resolves.toMatchObject(
        { id: sale.id },
      );
      await prisma.location.create({
        data: {
          id: warehouse,
          organizationId: fixture.orgAId,
          name: 'Warehouse',
        },
      });
      await expect(create(warehouse, 'origin-new-sale')).rejects.toMatchObject({
        status: 409,
        message:
          'La solicitud ya corresponde a una venta con otra atribución de sede',
      });
      for (const site of [principal, warehouse]) {
        await expect(create(site, 'origin-topology')).rejects.toMatchObject({
          status: 409,
          message:
            'El stock global solo permite ventas en la única sede principal',
        });
      }
      expect(await snapshot()).toEqual(after);

      await prisma.organizationUser.updateMany({
        where: { userId: actor.userId, organizationId: actor.organizationId },
        data: { role: OrgRole.CASHIER },
      });
      const cancel = () =>
        salesService.update(
          sale.id,
          { status: 'CANCELLED' },
          actor.userId,
          actor.organizationId,
          actor,
        );
      try {
        await expect(cancel()).rejects.toMatchObject({
          status: 403,
          message: 'Location authorization changed',
        });
        expect(await snapshot()).toEqual(after);
        expect(
          await prisma.sale.findUniqueOrThrow({
            where: { id: sale.id },
            select: { status: true },
          }),
        ).toEqual({ status: 'COMPLETED' });
      } finally {
        await prisma.organizationUser.updateMany({
          where: { userId: actor.userId, organizationId: actor.organizationId },
          data: { role: OrgRole.ADMIN },
        });
      }
      await expect(cancel()).resolves.toMatchObject({ status: 'CANCELLED' });
      expect(
        await prisma.inventoryMovement.findMany({
          where: { saleId: sale.id },
          orderBy: { type: 'asc' },
          select: { type: true, quantity: true, locationId: true },
        }),
      ).toEqual([
        { type: 'SALE', quantity: -1, locationId: principal },
        { type: 'RETURN', quantity: 1, locationId: principal },
      ]);
      expect(await snapshot()).toEqual({
        ...after,
        movements: after.movements + 1,
        // The reversal put the unit back on the site it left.
        siteLedger: before.siteLedger,
        product: {
          ...after.product,
          stock: before.product.stock,
          version: after.product.version + 1,
        },
      });
      // T3b: the sale and its reversal both move the same site row, so the
      // product ends with the row it was opened with, back at its balance.
      const ledger = (await snapshot()).siteLedger;
      expect(ledger).toEqual(before.siteLedger);
      expect(ledger).toEqual([
        expect.objectContaining({
          productId,
          locationId: principal,
          organizationId: fixture.orgAId,
        }),
      ]);
    });
  });
});
