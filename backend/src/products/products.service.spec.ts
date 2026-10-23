import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { computeEffectiveSalePrice, ProductsService } from './products.service';

describe('ProductsService — Opt-in tax resolution', () => {
  let service: ProductsService;

  // Sentinel standing in for the Prisma field reference (prisma.product
  // .fields.minStock) used by the low-stock where clause; compared by identity.
  const MIN_STOCK_FIELD_REF = { prismaFieldRef: 'Product.minStock' };
  const RESERVED_STOCK_FIELD_REF = { prismaFieldRef: 'Product.reservedStock' };

  // ── Mocks ──────────────────────────────────────────────────────────
  const prismaMock = {
    category: {
      findFirst: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      fields: {
        minStock: MIN_STOCK_FIELD_REF,
        reservedStock: RESERVED_STOCK_FIELD_REF,
      },
    },
    inventoryMovement: {
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const cloudinaryServiceMock = {};

  const planLimitServiceMock = {
    invalidateCache: jest.fn(),
  };

  const USER_ID = 'user-1';
  const ORG_ID = 'org-1';

  // ── Shared fixtures ────────────────────────────────────────────────
  const categoryWithDefault = (
    defaultTaxRate: number | null,
    taxable = false,
  ) => ({
    id: 'cat-1',
    name: 'Electrónica',
    description: null,
    defaultTaxRate,
    taxable,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const buildProduct = (overrides: Record<string, unknown> = {}) => ({
    id: 'prod-1',
    name: 'Test Product',
    sku: 'SKU-001',
    barcode: null,
    description: null,
    costPrice: 100,
    salePrice: 150,
    taxable: overrides.taxable ?? false,
    taxRate: overrides.taxRate ?? 0,
    type: ProductType.PRODUCT,
    stock: 10,
    reservedStock: 0,
    minStock: 5,
    tracksStock: true,
    imageUrl: null,
    categoryId: overrides.categoryId ?? 'cat-1',
    active: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: overrides.category ?? categoryWithDefault(null, false),
    ...overrides,
  });

  // ── Lifecycle ──────────────────────────────────────────────────────
  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductsService(
      prismaMock as never,
      cloudinaryServiceMock as never,
      planLimitServiceMock as never,
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // Product Creation
  // ════════════════════════════════════════════════════════════════════
  describe('Product Creation', () => {
    const baseDto = {
      name: 'Test Product',
      sku: 'SKU-001',
      costPrice: 100,
      salePrice: 150,
      stock: 10,
      minStock: 5,
      categoryId: 'cat-1',
    };

    it('stores taxable=true with the provided rate', async () => {
      prismaMock.category.findFirst.mockResolvedValue(
        categoryWithDefault(null, false),
      );
      prismaMock.product.findUnique.mockResolvedValue(null);
      prismaMock.product.create.mockResolvedValue(
        buildProduct({
          taxable: true,
          taxRate: 8,
          category: categoryWithDefault(null, false),
        }),
      );
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      const result = await service.create(
        { ...baseDto, taxable: true, taxRate: 8 },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taxable: true, taxRate: 8 }),
        }),
      );
      expect(result.taxable).toBe(true);
      expect(result.effectiveTaxRate).toBe(8);
    });

    it('forces taxRate to 0 when taxable is false even if a rate is supplied', async () => {
      prismaMock.category.findFirst.mockResolvedValue(
        categoryWithDefault(null, false),
      );
      prismaMock.product.findUnique.mockResolvedValue(null);
      prismaMock.product.create.mockResolvedValue(
        buildProduct({
          taxable: false,
          taxRate: 0,
          category: categoryWithDefault(null, false),
        }),
      );
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      await service.create(
        { ...baseDto, taxable: false, taxRate: 8 },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taxable: false, taxRate: 0 }),
        }),
      );
    });

    it('defaults to non-taxable (rate 0) when taxable is omitted', async () => {
      prismaMock.category.findFirst.mockResolvedValue(
        categoryWithDefault(null, false),
      );
      prismaMock.product.findUnique.mockResolvedValue(null);
      prismaMock.product.create.mockResolvedValue(
        buildProduct({
          taxable: false,
          taxRate: 0,
          category: categoryWithDefault(null, false),
        }),
      );
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      const result = await service.create(baseDto, USER_ID, ORG_ID);

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taxable: false, taxRate: 0 }),
        }),
      );
      expect(result.effectiveTaxRate).toBe(0);
    });

    it('throws BadRequestException when taxable is true without a rate', async () => {
      prismaMock.category.findFirst.mockResolvedValue(
        categoryWithDefault(null, false),
      );
      prismaMock.product.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ ...baseDto, taxable: true }, USER_ID, ORG_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when taxable is true with rate 0', async () => {
      prismaMock.category.findFirst.mockResolvedValue(
        categoryWithDefault(null, false),
      );
      prismaMock.product.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ ...baseDto, taxable: true, taxRate: 0 }, USER_ID, ORG_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when category does not exist', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ ...baseDto, sku: 'SKU-005' }, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when SKU already exists', async () => {
      prismaMock.category.findFirst.mockResolvedValue(
        categoryWithDefault(null, false),
      );
      prismaMock.product.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ ...baseDto, sku: 'DUPLICATE-SKU' }, USER_ID, ORG_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Product Update — tax behavior
  // ════════════════════════════════════════════════════════════════════
  describe('Product Update', () => {
    it('rejects a category owned by another organization before updating an owned product', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(buildProduct());
      prismaMock.category.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.update('prod-1', { categoryId: 'foreign-cat' }, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-cat', organizationId: ORG_ID },
      });
      expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
    });

    it('updates an owned product with a category from the same organization', async () => {
      const category = {
        ...categoryWithDefault(null),
        id: 'cat-2',
        organizationId: ORG_ID,
      };
      prismaMock.product.findFirst
        .mockResolvedValueOnce(buildProduct())
        .mockResolvedValueOnce(
          buildProduct({ categoryId: 'cat-2', category, version: 2 }),
        );
      prismaMock.category.findFirst.mockResolvedValueOnce(category);
      prismaMock.product.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.update(
        'prod-1',
        { categoryId: 'cat-2' },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'cat-2', organizationId: ORG_ID },
      });
      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ categoryId: 'cat-2' }),
        }),
      );
      expect(result.categoryId).toBe('cat-2');
    });

    it('stores taxable + rate when explicitly provided', async () => {
      const existing = buildProduct({ taxRate: 16, version: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(existing);
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(
        buildProduct({ taxable: true, taxRate: 5, version: 2 }),
      );
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      const result = await service.update(
        'prod-1',
        { taxable: true, taxRate: 5 },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taxable: true, taxRate: 5 }),
        }),
      );
      expect(result.taxable).toBe(true);
      expect(result.effectiveTaxRate).toBe(5);
    });

    it('forces taxRate to 0 when taxable is set to false', async () => {
      const existing = buildProduct({ taxable: true, taxRate: 8, version: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(existing);
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(
        buildProduct({ taxable: false, taxRate: 0, version: 2 }),
      );
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      await service.update('prod-1', { taxable: false }, USER_ID, ORG_ID);

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taxable: false, taxRate: 0 }),
        }),
      );
    });

    it('throws BadRequestException when taxable=true without a valid rate', async () => {
      const existing = buildProduct({ taxable: false, taxRate: 0, version: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(existing);

      await expect(
        service.update('prod-1', { taxable: true }, USER_ID, ORG_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not change taxable/taxRate when both are omitted', async () => {
      const existing = buildProduct({ taxable: true, taxRate: 16, version: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(existing);
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(
        buildProduct({ name: 'Renamed', version: 2 }),
      );
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      await service.update('prod-1', { name: 'Renamed Product' }, USER_ID, ORG_ID);

      const updateCall = prismaMock.product.updateMany.mock.calls[0][0];
      expect(updateCall.data.name).toBe('Renamed Product');
      expect(updateCall.data.taxable).toBeUndefined();
      expect(updateCall.data.taxRate).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Effective tax resolution (read path)
  // ════════════════════════════════════════════════════════════════════
  describe('Effective tax resolution (read path)', () => {
    it('falls back to the category rate when the product is not opted-in', async () => {
      const product = buildProduct({
        taxable: false,
        taxRate: 0,
        category: categoryWithDefault(16, true),
      });
      prismaMock.product.findFirst.mockResolvedValue(product);

      const result = await service.findOne('prod-1', ORG_ID);

      expect(result.effectiveTaxRate).toBe(16);
    });

    it('uses the product rate when the product is opted-in (overrides category)', async () => {
      const product = buildProduct({
        taxable: true,
        taxRate: 8,
        category: categoryWithDefault(16, true),
      });
      prismaMock.product.findFirst.mockResolvedValue(product);

      const result = await service.findOne('prod-1', ORG_ID);

      expect(result.effectiveTaxRate).toBe(8);
    });

    it('returns 0 when neither product nor category is opted-in', async () => {
      const product = buildProduct({
        taxable: false,
        taxRate: 0,
        category: categoryWithDefault(null, false),
      });
      prismaMock.product.findFirst.mockResolvedValue(product);

      const result = await service.findOne('prod-1', ORG_ID);

      expect(result.effectiveTaxRate).toBe(0);
    });

    it('findAll enriches every product with effectiveTaxRate', async () => {
      prismaMock.product.findMany.mockResolvedValue([
        buildProduct({ id: 'p1', taxable: true, taxRate: 8 }),
        buildProduct({
          id: 'p2',
          taxable: false,
          taxRate: 0,
          category: categoryWithDefault(16, true),
        }),
        buildProduct({
          id: 'p3',
          taxable: false,
          taxRate: 0,
          category: categoryWithDefault(null, false),
        }),
      ]);
      prismaMock.product.count.mockResolvedValue(3);

      const result = await service.findAll(ORG_ID, 1, 10);

      expect(result.data[0].effectiveTaxRate).toBe(8);
      expect(result.data[1].effectiveTaxRate).toBe(16);
      expect(result.data[2].effectiveTaxRate).toBe(0);
    });
  });

  describe('Quick search', () => {
    it('returns null when code is blank after trimming', async () => {
      const result = await service.quickSearch('   ', ORG_ID);

      expect(result).toBeNull();
      expect(prismaMock.product.findFirst).not.toHaveBeenCalled();
    });

    it('trims the incoming code before searching by barcode or SKU', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({
          id: 'prod-scan-1',
          sku: 'SCAN-001',
          barcode: '7701234567890',
        }),
      );

      const result = await service.quickSearch('  7701234567890  ', ORG_ID);

      expect(prismaMock.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG_ID,
            active: true,
            OR: [
              { barcode: { equals: '7701234567890', mode: 'insensitive' } },
              { sku: { equals: '7701234567890', mode: 'insensitive' } },
            ],
          },
        }),
      );
      expect(result?.barcode).toBe('7701234567890');
    });
  });

  describe('Search promotion parity (live service path)', () => {
    // Every search payload carries exactly these keys: all prior flat fields,
    // the product/service discriminator, the stock-tracking flag, the two
    // additive promotion fields, and the derived effective price.
    const FLAT_PAYLOAD_KEYS = [
      'id',
      'name',
      'sku',
      'barcode',
      'salePrice',
      'stock',
      'availableStock',
      'taxable',
      'taxRate',
      'effectiveTaxRate',
      'minStock',
      'type',
      'tracksStock',
      'isLowStock',
      'category',
      'imageUrl',
      'promotionType',
      'promotionValue',
      'effectiveSalePrice',
    ];

    // Exact-key-set assertion: proves every prior field is retained, the promo
    // keys are additive, and no envelope key (success/data) leaks in — without
    // comparing Date instances inside the category fixture.
    const expectExactFlatPayload = (result: Record<string, unknown>) => {
      expect(Object.keys(result).sort()).toEqual([...FLAT_PAYLOAD_KEYS].sort());
      expect(result).not.toHaveProperty('success');
      expect(result).not.toHaveProperty('data');
    };

    it('searchProducts returns promo keys + effectiveSalePrice and keeps every prior field', async () => {
      const promoRow = buildProduct({
        salePrice: 19900,
        promotionType: 'PERCENTAGE',
        promotionValue: 15,
      });
      prismaMock.product.findMany.mockResolvedValue([promoRow]);

      const [result] = await service.searchProducts('donut', 20, ORG_ID);

      expectExactFlatPayload(result as Record<string, unknown>);
      expect(result).toMatchObject({
        id: 'prod-1',
        name: 'Test Product',
        sku: 'SKU-001',
        barcode: null,
        salePrice: 19900,
        stock: 10,
        taxable: false,
        taxRate: 0,
        effectiveTaxRate: 0,
        minStock: 5,
        tracksStock: true,
        isLowStock: false,
        imageUrl: null,
      });
      // category passes through by reference (service does not clone it)
      expect(result?.category).toBe(promoRow.category);
      expect(result?.promotionType).toBe('PERCENTAGE');
      expect(result?.promotionValue).toBe(15);
      expect(result?.effectiveSalePrice).toBe(16915);
    });

    it('searchProducts keeps fields intact and nulls effectiveSalePrice without a promotion', async () => {
      const plainRow = buildProduct({
        promotionType: null,
        promotionValue: null,
      });
      prismaMock.product.findMany.mockResolvedValue([plainRow]);

      const [result] = await service.searchProducts('donut', 20, ORG_ID);

      expectExactFlatPayload(result as Record<string, unknown>);
      expect(result).toMatchObject({
        id: 'prod-1',
        name: 'Test Product',
        sku: 'SKU-001',
        barcode: null,
        salePrice: 150,
        stock: 10,
        taxable: false,
        taxRate: 0,
        effectiveTaxRate: 0,
        minStock: 5,
        tracksStock: true,
        isLowStock: false,
        imageUrl: null,
      });
      expect(result?.category).toBe(plainRow.category);
      expect(result?.promotionType).toBeNull();
      expect(result?.promotionValue).toBeNull();
      expect(result?.effectiveSalePrice).toBeNull();
    });

    it('quickSearch returns promo keys + effectiveSalePrice (FIXED_PRICE branch) and keeps every prior field', async () => {
      const promoRow = buildProduct({
        barcode: '7701234567890',
        salePrice: 19900,
        promotionType: 'FIXED_PRICE',
        promotionValue: 15000,
      });
      prismaMock.product.findFirst.mockResolvedValue(promoRow);

      const result = await service.quickSearch('7701234567890', ORG_ID);

      expectExactFlatPayload(result as Record<string, unknown>);
      expect(result).toMatchObject({
        id: 'prod-1',
        name: 'Test Product',
        sku: 'SKU-001',
        barcode: '7701234567890',
        salePrice: 19900,
        stock: 10,
        taxable: false,
        taxRate: 0,
        effectiveTaxRate: 0,
        minStock: 5,
        tracksStock: true,
        isLowStock: false,
        imageUrl: null,
      });
      expect(result?.category).toBe(promoRow.category);
      expect(result?.promotionType).toBe('FIXED_PRICE');
      expect(result?.promotionValue).toBe(15000);
      expect(result?.effectiveSalePrice).toBe(15000);
    });

    it('quickSearch keeps fields intact and nulls effectiveSalePrice without a promotion', async () => {
      const plainRow = buildProduct({
        barcode: '7701234567890',
        promotionType: null,
        promotionValue: null,
      });
      prismaMock.product.findFirst.mockResolvedValue(plainRow);

      const result = await service.quickSearch('7701234567890', ORG_ID);

      expectExactFlatPayload(result as Record<string, unknown>);
      expect(result).toMatchObject({
        id: 'prod-1',
        name: 'Test Product',
        sku: 'SKU-001',
        barcode: '7701234567890',
        salePrice: 150,
        stock: 10,
        taxable: false,
        taxRate: 0,
        effectiveTaxRate: 0,
        minStock: 5,
        tracksStock: true,
        isLowStock: false,
        imageUrl: null,
      });
      expect(result?.category).toBe(plainRow.category);
      expect(result?.promotionType).toBeNull();
      expect(result?.promotionValue).toBeNull();
      expect(result?.effectiveSalePrice).toBeNull();
    });
  });

  describe('Organization-scoped queries', () => {
    it('findAll filters by organizationId', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);
      prismaMock.product.count.mockResolvedValue(0);

      await service.findAll(ORG_ID, 1, 10);

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_ID }),
        }),
      );
      expect(prismaMock.product.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_ID }),
        }),
      );
    });

    it('findOne filters by organizationId', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({ id: 'prod-1' }),
      );

      await service.findOne('prod-1', ORG_ID);

      expect(prismaMock.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prod-1', organizationId: ORG_ID, active: true },
        }),
      );
    });

    it('deactivate validates organizationId', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({ id: 'prod-1' }),
      );
      prismaMock.product.update.mockResolvedValue({});

      await service.deactivate('prod-1', ORG_ID);

      expect(prismaMock.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prod-1', organizationId: ORG_ID, active: true },
        }),
      );
    });

    it('reactivate validates organizationId', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({ id: 'prod-1', active: false }),
      );
      prismaMock.product.update.mockResolvedValue({});

      await service.reactivate('prod-1', ORG_ID);

      expect(prismaMock.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prod-1', organizationId: ORG_ID },
        }),
      );
    });

    it('remove validates organizationId', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({ id: 'prod-1' }),
      );
      prismaMock.product.delete.mockResolvedValue({});

      await service.remove('prod-1', ORG_ID);

      expect(prismaMock.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prod-1', organizationId: ORG_ID },
        }),
      );
    });

    it('searchProducts filters by organizationId', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);

      await service.searchProducts('query', 20, ORG_ID);

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_ID }),
        }),
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Low stock lookup
  // ════════════════════════════════════════════════════════════════════
  describe('Low stock lookup', () => {
    it('rejects low-stock lookups without an organization context', async () => {
      await expect(
        service.getLowStockProducts(undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('filters low-stock products by organization', async () => {
      const row = {
        ...buildProduct({ name: 'Panela', stock: 2 }),
        categoryName: 'Electrónica',
      };
      prismaMock.$queryRaw.mockResolvedValue([row]);

      const result = await service.getLowStockProducts(ORG_ID);

      expect(result).toEqual([{ ...row, availableStock: 2 }]);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Effective sale price derivation (promotions)
  // ════════════════════════════════════════════════════════════════════
  describe('computeEffectiveSalePrice', () => {
    it('derives a percentage promo from the list price', () => {
      expect(
        computeEffectiveSalePrice({
          salePrice: 19900,
          promotionType: 'PERCENTAGE',
          promotionValue: 15,
        }),
      ).toBe(16915);
    });

    it('returns the promotion value for a fixed-price promo', () => {
      expect(
        computeEffectiveSalePrice({
          salePrice: 10000,
          promotionType: 'FIXED_PRICE',
          promotionValue: 8000,
        }),
      ).toBe(8000);
    });

    it('returns null when the product has no active promotion', () => {
      expect(
        computeEffectiveSalePrice({
          salePrice: 19900,
          promotionType: null,
          promotionValue: null,
        }),
      ).toBeNull();
      expect(computeEffectiveSalePrice({ salePrice: 19900 })).toBeNull();
    });

    it('rounds half-up to two decimals', () => {
      expect(
        computeEffectiveSalePrice({
          salePrice: 999,
          promotionType: 'PERCENTAGE',
          promotionValue: 12.5,
        }),
      ).toBe(874.13);
    });

    it('accepts Prisma Decimal inputs', () => {
      expect(
        computeEffectiveSalePrice({
          salePrice: new Prisma.Decimal('19900'),
          promotionType: 'PERCENTAGE',
          promotionValue: new Prisma.Decimal('15'),
        }),
      ).toBe(16915);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Promotion enrichment on reads
  // ════════════════════════════════════════════════════════════════════
  describe('Promotion enrichment on reads', () => {
    const baseDto = {
      name: 'Promo Product',
      sku: 'SKU-PROMO',
      costPrice: 100,
      salePrice: 19900,
      stock: 10,
      minStock: 5,
      categoryId: 'cat-1',
    };

    const promoProduct = buildProduct({
      salePrice: 19900,
      promotionType: 'PERCENTAGE',
      promotionValue: 15,
    });

    it('create persists the promotion and returns effectiveSalePrice', async () => {
      prismaMock.category.findFirst.mockResolvedValue(
        categoryWithDefault(null, false),
      );
      prismaMock.product.findUnique.mockResolvedValue(null);
      prismaMock.product.create.mockResolvedValue(promoProduct);
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      const result = await service.create(
        {
          ...baseDto,
          promotionType: 'PERCENTAGE',
          promotionValue: 15,
        },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            promotionType: 'PERCENTAGE',
            promotionValue: 15,
          }),
        }),
      );
      expect(result.effectiveSalePrice).toBe(16915);
    });

    it('findAll enriches every product with effectiveSalePrice', async () => {
      prismaMock.product.findMany.mockResolvedValue([
        promoProduct,
        buildProduct({ id: 'p2' }),
      ]);
      prismaMock.product.count.mockResolvedValue(2);

      const result = await service.findAll(ORG_ID, 1, 10);

      expect(result.data[0].effectiveSalePrice).toBe(16915);
      expect(result.data[1].effectiveSalePrice).toBeNull();
    });

    it('findOne returns effectiveSalePrice for a promoted product', async () => {
      prismaMock.product.findFirst.mockResolvedValue(promoProduct);

      const result = await service.findOne('prod-1', ORG_ID);

      expect(result.effectiveSalePrice).toBe(16915);
    });

    it('update returns effectiveSalePrice for the updated product', async () => {
      prismaMock.product.findFirst
        .mockResolvedValueOnce(buildProduct({ version: 1 }))
        .mockResolvedValueOnce(promoProduct);
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      const result = await service.update(
        'prod-1',
        { promotionType: 'PERCENTAGE', promotionValue: 15 },
        USER_ID,
        ORG_ID,
      );

      expect(result.effectiveSalePrice).toBe(16915);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Promotion validation (cross-field invariants)
  // ════════════════════════════════════════════════════════════════════
  describe('Promotion validation', () => {
    const createBase = {
      name: 'Promo Product',
      sku: 'SKU-PROMO-2',
      costPrice: 100,
      salePrice: 10000,
      stock: 10,
      minStock: 5,
      categoryId: 'cat-1',
    };

    const setupCreateSuccess = () => {
      prismaMock.category.findFirst.mockResolvedValue(
        categoryWithDefault(null, false),
      );
      prismaMock.product.findUnique.mockResolvedValue(null);
      prismaMock.product.create.mockResolvedValue(buildProduct());
      prismaMock.inventoryMovement.create.mockResolvedValue({});
    };

    it('rejects PERCENTAGE values above 100 on create', async () => {
      setupCreateSuccess();

      await expect(
        service.create(
          { ...createBase, promotionType: 'PERCENTAGE', promotionValue: 150 },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(/promotionValue.*100/);
    });

    it('rejects FIXED_PRICE at or above the sale price on create', async () => {
      setupCreateSuccess();

      await expect(
        service.create(
          { ...createBase, promotionType: 'FIXED_PRICE', promotionValue: 10000 },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(/promotionValue.*salePrice/);
    });

    it('rejects FIXED_PRICE of 0 or less', async () => {
      setupCreateSuccess();

      await expect(
        service.create(
          { ...createBase, promotionType: 'FIXED_PRICE', promotionValue: 0 },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(/promotionValue/);
    });

    it('rejects a promotion type sent without a value', async () => {
      setupCreateSuccess();

      await expect(
        service.create(
          { ...createBase, promotionType: 'PERCENTAGE' },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(/together/);
    });

    it('validates FIXED_PRICE against the new salePrice when salePrice is also updated', async () => {
      const existing = buildProduct({ salePrice: 20000, version: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(existing);

      await expect(
        service.update(
          'prod-1',
          { salePrice: 5000, promotionType: 'FIXED_PRICE', promotionValue: 6000 },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(/promotionValue.*salePrice/);
    });

    it('validates FIXED_PRICE against the existing salePrice when salePrice is omitted', async () => {
      const existing = buildProduct({ salePrice: 10000, version: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(existing);

      await expect(
        service.update(
          'prod-1',
          { promotionType: 'FIXED_PRICE', promotionValue: 12000 },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(/promotionValue.*salePrice/);
    });

    it('clears the promotion when both fields are explicitly null and exposes null effectiveSalePrice', async () => {
      const existing = buildProduct({
        salePrice: 19900,
        promotionType: 'PERCENTAGE',
        promotionValue: 15,
        version: 3,
      });
      prismaMock.product.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(buildProduct({ version: 4 }));
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.update(
        'prod-1',
        { promotionType: null, promotionValue: null },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            promotionType: null,
            promotionValue: null,
          }),
        }),
      );
      expect(result.effectiveSalePrice).toBeNull();
    });

    it('keeps optimistic concurrency intact on promo updates (version where + increment)', async () => {
      const existing = buildProduct({ version: 3 });
      prismaMock.product.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(
          buildProduct({ promotionType: 'PERCENTAGE', promotionValue: 20, version: 4 }),
        );
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });

      await service.update(
        'prod-1',
        { promotionType: 'PERCENTAGE', promotionValue: 20 },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'prod-1', version: 3 }),
          data: expect.objectContaining({ version: { increment: 1 } }),
        }),
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // findAll — additive lowStock/orderBy params (D5, inventory pagination)
  // ════════════════════════════════════════════════════════════════════
  describe('findAll — additive lowStock/orderBy params', () => {
    const setupFindAll = () => {
      prismaMock.product.findMany.mockResolvedValue([]);
      prismaMock.product.count.mockResolvedValue(0);
    };

    it('intersects IDs and availability with search/type before both paging and count', async () => {
      setupFindAll();
      const id = '00000000-0000-4000-8000-000000000001';
      prismaMock.product.count.mockResolvedValue(7);
      const result = await service.findAll(
        ORG_ID,
        2,
        3,
        'repair',
        'cat-2',
        'active',
        false,
        'name',
        ProductType.SERVICE,
        [id, id],
        true,
      );
      const rows = (
        prismaMock.product.findMany.mock.calls as [
          { where: Record<string, unknown> },
        ][]
      )[0][0];
      expect(rows).toMatchObject({
        skip: 3,
        take: 3,
        where: {
          organizationId: ORG_ID,
          active: true,
          categoryId: 'cat-2',
          type: ProductType.SERVICE,
          id: { in: [id] },
          OR: expect.any(Array) as unknown,
          AND: [
            {
              OR: [
                { type: ProductType.SERVICE },
                { tracksStock: false },
                { stock: { gt: RESERVED_STOCK_FIELD_REF } },
              ],
            },
          ],
        },
      });
      expect(prismaMock.product.count).toHaveBeenCalledWith({
        where: rows.where,
      });
      expect(result.meta).toMatchObject({ total: 7, totalPages: 3 });
    });

    it('keeps empty IDs restrictive and rejects malformed IDs rather than dropping the filter', async () => {
      setupFindAll();
      await service.findAll(
        ORG_ID,
        1,
        3,
        undefined,
        undefined,
        'active',
        false,
        'name',
        undefined,
        [],
      );
      const rows = (
        prismaMock.product.findMany.mock.calls as [
          { where: Record<string, unknown> },
        ][]
      )[0][0];
      expect(rows.where.id).toEqual({ in: [] });
      await expect(
        service.findAll(
          ORG_ID,
          1,
          3,
          undefined,
          undefined,
          'active',
          false,
          'name',
          undefined,
          ['bad'],
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('counts eligibility across zero-stock services, untracked and stocked merchandise before slicing', async () => {
      const fixture = [
        buildProduct({
          type: ProductType.SERVICE,
          tracksStock: false,
          stock: 0,
        }),
        buildProduct({
          id: 'untracked',
          type: ProductType.PRODUCT,
          tracksStock: false,
          stock: 0,
        }),
        buildProduct({
          id: 'stocked',
          type: ProductType.PRODUCT,
          tracksStock: true,
          stock: 2,
          reservedStock: 1,
        }),
        buildProduct({
          id: 'reserved',
          type: ProductType.PRODUCT,
          tracksStock: true,
          stock: 2,
          reservedStock: 2,
        }),
        buildProduct({
          id: 'empty',
          type: ProductType.PRODUCT,
          tracksStock: true,
          stock: 0,
        }),
      ];
      type EligibilityWhere = {
        AND?: {
          OR: {
            type?: ProductType;
            tracksStock?: boolean;
            stock?: { gt: unknown };
          }[];
        }[];
      };
      const select = (where: EligibilityWhere) =>
        fixture.filter(
          (p) =>
            !where.AND ||
            where.AND.every((clause) =>
              clause.OR.some(
                (branch) =>
                  branch.type === p.type ||
                  branch.tracksStock === p.tracksStock ||
                  (branch.stock !== undefined &&
                    p.stock >
                      (branch.stock.gt === RESERVED_STOCK_FIELD_REF
                        ? p.reservedStock
                        : Number(branch.stock.gt))),
              ),
            ),
        );
      prismaMock.product.findMany.mockImplementation(
        ({
          where,
          skip,
          take,
        }: {
          where: EligibilityWhere;
          skip: number;
          take: number;
        }) => Promise.resolve(select(where).slice(skip, skip + take)),
      );
      prismaMock.product.count.mockImplementation(
        ({ where }: { where: EligibilityWhere }) =>
          Promise.resolve(select(where).length),
      );
      const result = await service.findAll(
        ORG_ID,
        2,
        2,
        undefined,
        undefined,
        'active',
        false,
        'name',
        undefined,
        undefined,
        true,
      );
      expect(result.meta).toMatchObject({ total: 3, totalPages: 2 });
      expect(result.data.map((p: { id: string }) => p.id)).toEqual(['stocked']);
      const defaultResult = await service.findAll(ORG_ID, 1, 10);
      expect(defaultResult.meta.total).toBe(5);
    });

    it('retains every valid ID rather than capping favorites and composes low-stock availability', async () => {
      setupFindAll();
      const ids = Array.from(
        { length: 250 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );
      await service.findAll(
        ORG_ID,
        1,
        3,
        'repair',
        undefined,
        'active',
        true,
        'name',
        ProductType.SERVICE,
        ids,
        true,
      );
      const { where } = (
        prismaMock.product.findMany.mock.calls as [
          { where: Record<string, unknown> },
        ][]
      )[0][0];
      expect(where.id).toEqual({ in: ids });
      expect(where.AND).toEqual([
        { type: ProductType.PRODUCT },
        {
          OR: [
            { type: ProductType.SERVICE },
            { tracksStock: false },
            { stock: { gt: RESERVED_STOCK_FIELD_REF } },
          ],
        },
      ]);
      expect(where).toMatchObject({
        active: true,
        organizationId: ORG_ID,
        type: ProductType.SERVICE,
        tracksStock: true,
        stock: { lte: MIN_STOCK_FIELD_REF },
      });
      expect(prismaMock.product.count).toHaveBeenCalledWith({ where });
    });

    it('applies service type before paging and uses the same scoped where for count', async () => {
      setupFindAll();
      prismaMock.product.count.mockResolvedValue(25);
      const result = await Reflect.apply(service.findAll, service, [ORG_ID, 2, 6, 'repair', 'cat-2', 'active', false, 'name', ProductType.SERVICE]);
      const rows = prismaMock.product.findMany.mock.calls[0][0];
      expect(rows).toEqual(expect.objectContaining({
        skip: 6, take: 6,
        where: expect.objectContaining({ organizationId: ORG_ID, active: true, categoryId: 'cat-2', type: ProductType.SERVICE, OR: expect.any(Array) }),
      }));
      expect(prismaMock.product.count).toHaveBeenCalledWith({ where: rows.where });
      expect(result.meta).toEqual({ total: 25, page: 2, limit: 6, totalPages: 5 });
    });

    it('intersects service and low-stock filters rather than returning merchandise', async () => {
      setupFindAll();
      await Reflect.apply(service.findAll, service, [ORG_ID, 1, 6, undefined, undefined, 'active', true, 'name', ProductType.SERVICE]);
      const where = prismaMock.product.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({
        type: ProductType.SERVICE, tracksStock: true,
        stock: { lte: MIN_STOCK_FIELD_REF }, AND: [{ type: ProductType.PRODUCT }],
      }));
      expect(prismaMock.product.count).toHaveBeenCalledWith({ where });
    });

    it('filters stock <= minStock via a field reference when lowStock is true', async () => {
      setupFindAll();

      await service.findAll(ORG_ID, 1, 10, undefined, undefined, 'active', true);

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stock: { lte: MIN_STOCK_FIELD_REF },
          }),
        }),
      );
    });

    it('orders by name ascending when orderBy is "name"', async () => {
      setupFindAll();

      await service.findAll(
        ORG_ID,
        1,
        10,
        undefined,
        undefined,
        'active',
        undefined,
        'name',
      );

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });

    it('composes the low-stock filter with search and category filters', async () => {
      setupFindAll();

      await service.findAll(ORG_ID, 1, 10, 'panela', 'cat-2', 'active', true);

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_ID,
            categoryId: 'cat-2',
            OR: expect.any(Array),
            stock: { lte: MIN_STOCK_FIELD_REF },
          }),
        }),
      );
    });

    it('keeps current behavior by default (createdAt desc, no stock filter)', async () => {
      setupFindAll();

      await service.findAll(ORG_ID, 1, 10);

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          where: expect.not.objectContaining({ stock: expect.anything() }),
        }),
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Low-stock flag on every product response
  // ════════════════════════════════════════════════════════════════════
  //
  // The client used to re-derive the low-stock rule in three places, and one of them
  // gated on `isService` instead of `tracksStock`, so an untracked product with stale
  // numbers was badged "low on stock" while the server's own rule said false. The fix is
  // to ship the server's answer on every read so no consumer has to re-derive it.
  describe('server-owned availableStock', () => {
    it.each([
      'create',
      'update',
      'list',
      'detail',
      'search',
      'quick',
      'lowStock',
    ] as const)(
      '%s returns availability without changing physical stock or response keys',
      async (path) => {
        const row = buildProduct({ stock: 10, reservedStock: 10, minStock: 5 });
        prismaMock.category.findFirst.mockResolvedValue(
          categoryWithDefault(null),
        );
        prismaMock.product.create.mockResolvedValue(row);
        prismaMock.product.findFirst.mockResolvedValue(row);
        prismaMock.product.findMany.mockResolvedValue([row]);
        prismaMock.product.count.mockResolvedValue(1);
        prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
        prismaMock.$queryRaw.mockResolvedValue([
          { ...row, categoryName: 'Electrónica' },
        ]);
        const dto = {
          name: row.name,
          costPrice: 100,
          salePrice: 150,
          stock: 10,
          minStock: 5,
          categoryId: 'cat-1',
        };
        const readers = {
          create: () => service.create(dto, USER_ID, ORG_ID),
          update: () =>
            service.update(row.id, { name: row.name }, USER_ID, ORG_ID),
          list: async () => (await service.findAll(ORG_ID)).data[0],
          detail: () => service.findOne(row.id, ORG_ID),
          search: async () =>
            (await service.searchProducts('test', 20, ORG_ID))[0],
          quick: () => service.quickSearch(row.sku, ORG_ID),
          lowStock: async () => (await service.getLowStockProducts(ORG_ID))[0],
        };
        const result = await readers[path]();
        expect(result).toMatchObject({ stock: 10, availableStock: 0 });
        if (path !== 'lowStock') {
          expect(result).toMatchObject({
            isLowStock: false,
            effectiveTaxRate: 0,
            effectiveSalePrice: null,
          });
        } else {
          expect(result).toMatchObject({
            categoryName: 'Electrónica',
            reservedStock: 10,
          });
          const [sql, tenant] = prismaMock.$queryRaw.mock.calls[0] as [
            TemplateStringsArray,
            string,
          ];
          expect(sql.join('?')).toContain('p.stock <= p."minStock"');
          expect(tenant).toBe(ORG_ID);
        }
        if (path === 'search' || path === 'quick') {
          expect(Object.keys(result!)).toEqual([
            'id',
            'name',
            'sku',
            'barcode',
            'salePrice',
            'stock',
            'availableStock',
            'taxable',
            'taxRate',
            'effectiveTaxRate',
            'minStock',
            'type',
            'tracksStock',
            'isLowStock',
            'category',
            'imageUrl',
            'promotionType',
            'promotionValue',
            'effectiveSalePrice',
          ]);
        }
      },
    );

    it.each([
      {
        type: ProductType.PRODUCT,
        tracksStock: true,
        reservedStock: 3,
        expected: 7,
      },
      {
        type: ProductType.PRODUCT,
        tracksStock: true,
        reservedStock: 0,
        expected: 10,
      },
      {
        type: ProductType.SERVICE,
        tracksStock: false,
        reservedStock: 0,
        expected: null,
      },
      {
        type: ProductType.PRODUCT,
        tracksStock: false,
        reservedStock: 0,
        expected: null,
      },
    ])(
      'uses actual stock controls on list/detail/search/quick: %j',
      async ({ expected, ...controls }) => {
        const row = buildProduct(controls);
        prismaMock.product.findMany.mockResolvedValue([row]);
        prismaMock.product.count.mockResolvedValue(1);
        prismaMock.product.findFirst.mockResolvedValue(row);
        const results = [
          (await service.findAll(ORG_ID)).data[0],
          await service.findOne(row.id, ORG_ID),
          (await service.searchProducts('test', 20, ORG_ID))[0],
          await service.quickSearch(row.sku, ORG_ID),
        ];
        for (const result of results)
          expect(result).toMatchObject({ availableStock: expected, stock: 10 });
      },
    );

    it.each(['reservedStock', 'type', 'tracksStock'])(
      'rejects a stale queried row missing %s instead of supplying a default',
      async (field) => {
        const row: Record<string, unknown> = buildProduct();
        delete row[field];
        prismaMock.product.findFirst.mockResolvedValue(row);
        await expect(service.findOne('prod-1', ORG_ID)).rejects.toThrow();
      },
    );
  });

  describe('isLowStock is present on every product response', () => {
    const setupFindAll = (rows: ReturnType<typeof buildProduct>[]) => {
      prismaMock.product.findMany.mockResolvedValue(rows);
      prismaMock.product.count.mockResolvedValue(rows.length);
    };

    it('findAll carries the flag, true for a tracked product at or below minStock', async () => {
      setupFindAll([buildProduct({ stock: 5, minStock: 5 })]);

      const result = await service.findAll(ORG_ID, 1, 10);

      expect(result.data[0]).toMatchObject({
        stock: 5,
        minStock: 5,
        isLowStock: true,
      });
    });

    it('findAll carries the flag, false for a tracked product above minStock', async () => {
      setupFindAll([buildProduct({ stock: 6, minStock: 5 })]);

      const result = await service.findAll(ORG_ID, 1, 10);

      expect(result.data[0]).toMatchObject({
        stock: 6,
        minStock: 5,
        isLowStock: false,
      });
    });

    it('findAll reports an untracked product as NOT low even when its numbers qualify', async () => {
      // stock 2 <= minStock 5 would qualify on the numbers alone; nothing counts it.
      setupFindAll([
        buildProduct({
          type: ProductType.PRODUCT,
          tracksStock: false,
          stock: 2,
          minStock: 5,
        }),
      ]);

      const result = await service.findAll(ORG_ID, 1, 10);

      expect(result.data[0]).toMatchObject({
        tracksStock: false,
        stock: 2,
        minStock: 5,
        isLowStock: false,
      });
    });

    it('findAll reports a service as NOT low even when its numbers qualify', async () => {
      setupFindAll([
        buildProduct({
          type: ProductType.SERVICE,
          tracksStock: false,
          stock: 0,
          minStock: 5,
        }),
      ]);

      const result = await service.findAll(ORG_ID, 1, 10);

      expect(result.data[0]).toMatchObject({
        type: ProductType.SERVICE,
        isLowStock: false,
      });
    });

    it('findOne carries the flag', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({ stock: 3, minStock: 5 }),
      );

      const result = await service.findOne('prod-1', ORG_ID);

      expect(result).toMatchObject({ stock: 3, minStock: 5, isLowStock: true });
    });

    it('findOne reports an untracked product as NOT low', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({ tracksStock: false, stock: 1, minStock: 5 }),
      );

      const result = await service.findOne('prod-1', ORG_ID);

      expect(result).toMatchObject({ isLowStock: false });
    });

    it('create carries the flag', async () => {
      prismaMock.category.findFirst.mockResolvedValue(
        categoryWithDefault(null, false),
      );
      prismaMock.product.findUnique.mockResolvedValue(null);
      prismaMock.product.create.mockResolvedValue(
        buildProduct({ stock: 4, minStock: 5 }),
      );
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      const result = await service.create(
        {
          name: 'Test Product',
          sku: 'SKU-001',
          costPrice: 100,
          salePrice: 150,
          stock: 4,
          minStock: 5,
          categoryId: 'cat-1',
        },
        USER_ID,
        ORG_ID,
      );

      expect(result).toMatchObject({ stock: 4, minStock: 5, isLowStock: true });
    });

    it('update carries the flag', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({ id: 'prod-1', stock: 10, minStock: 5 }),
      );
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.product.findFirst
        .mockResolvedValueOnce(
          buildProduct({ id: 'prod-1', stock: 10, minStock: 5 }),
        )
        .mockResolvedValueOnce(
          buildProduct({ id: 'prod-1', stock: 2, minStock: 5 }),
        );
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      const result = await service.update(
        'prod-1',
        { stock: 2 },
        USER_ID,
        ORG_ID,
      );

      expect(result).toMatchObject({ stock: 2, minStock: 5, isLowStock: true });
    });

    it('adds the flag exactly once, without disturbing the promo and tax fields', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({ stock: 1, minStock: 5 }),
      );

      const result = await service.findOne('prod-1', ORG_ID);

      expect(result).toMatchObject({
        isLowStock: true,
        effectiveSalePrice: null,
        effectiveTaxRate: 0,
      });
    });
  });
});
