import { ConflictException } from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { UpdateProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

/**
 * A service is not merchandise. It carries no stock, writes no kárdex movement, is
 * never reported as low on stock, and is excluded from the low-stock surfaces.
 *
 * These specs are deliberately separate from `products.service.spec.ts` so the
 * service-specific contract stays reviewable on its own.
 */
describe('ProductsService — product versus service', () => {
  let service: ProductsService;

  // Sentinel standing in for the Prisma field reference used by the low-stock where
  // clause; compared by identity, exactly like the existing products spec does.
  const MIN_STOCK_FIELD_REF = { prismaFieldRef: 'Product.minStock' };

  const prismaMock = {
    category: { findFirst: jest.fn() },
    product: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      fields: { minStock: MIN_STOCK_FIELD_REF },
    },
    inventoryMovement: { create: jest.fn() },
    $queryRaw: jest.fn(),
    inventoryLoanItem: {
      findFirst: jest.fn(),
      fields: { returnedQuantity: { name: 'returnedQuantity' } },
    },
    $transaction: jest.fn(),
  };

  const cloudinaryServiceMock = {};
  const planLimitServiceMock = { invalidateCache: jest.fn() };

  const USER_ID = 'user-1';
  const ORG_ID = 'org-1';

  const categoryRow = () => ({
    id: 'cat-1',
    name: 'Mecánica',
    defaultTaxRate: null,
    taxable: false,
    active: true,
  });

  const buildProduct = (overrides: Record<string, unknown> = {}) => ({
    id: 'prod-1',
    name: 'Test Product',
    sku: 'SKU-001',
    barcode: null,
    description: null,
    costPrice: 100,
    salePrice: 150,
    taxable: false,
    taxRate: 0,
    stock: 10,
    reservedStock: 0,
    minStock: 5,
    type: ProductType.PRODUCT,
    tracksStock: overrides.type !== ProductType.SERVICE,
    imageUrl: null,
    categoryId: 'cat-1',
    active: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    promotionType: null,
    promotionValue: null,
    category: categoryRow(),
    ...overrides,
  });

  const baseCreateDto = {
    name: 'MANTENIMIENTO',
    sku: 'SERV 4',
    costPrice: 10000,
    salePrice: 20000,
    stock: 0,
    minStock: 0,
    categoryId: 'cat-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductsService(
      prismaMock as never,
      cloudinaryServiceMock as never,
      planLimitServiceMock as never,
    );
    prismaMock.category.findFirst.mockResolvedValue(categoryRow());
    prismaMock.product.findUnique.mockResolvedValue(null);
    prismaMock.inventoryMovement.create.mockResolvedValue({});
    prismaMock.inventoryLoanItem.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof prismaMock) => Promise<unknown>) =>
        callback(prismaMock),
    );
  });

  describe('create', () => {
    it('persists a service with zero stock even when the payload invents a stock', async () => {
      prismaMock.product.create.mockResolvedValue(
        buildProduct({ type: ProductType.SERVICE, stock: 0 }),
      );

      await service.create(
        { ...baseCreateDto, type: ProductType.SERVICE, stock: 9996 },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: ProductType.SERVICE,
            stock: 0,
          }),
        }),
      );
      expect(prismaMock.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('still records the opening PURCHASE movement for a real product', async () => {
      prismaMock.product.create.mockResolvedValue(
        buildProduct({ type: ProductType.PRODUCT, stock: 10 }),
      );

      await service.create(
        {
          ...baseCreateDto,
          name: 'PASTILLAS',
          type: ProductType.PRODUCT,
          stock: 10,
        },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stock: 10 }),
        }),
      );
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PURCHASE',
            quantity: 10,
            previousStock: 0,
            newStock: 10,
          }),
        }),
      );
    });
  });

  describe('the write boundary', () => {
    it('forces tracksStock to false when a service is created with the flag on', async () => {
      // The invariant is enforced at the write boundary, so no invalid
      // combination can be stored.
      prismaMock.product.create.mockResolvedValue(
        buildProduct({
          type: ProductType.SERVICE,
          stock: 0,
          tracksStock: false,
        }),
      );

      const payload = {
        ...baseCreateDto,
        type: ProductType.SERVICE,
        tracksStock: true,
        stock: 9996,
      };

      await service.create(payload, USER_ID, ORG_ID);

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: ProductType.SERVICE,
            tracksStock: false,
            stock: 0,
          }),
        }),
      );
      expect(prismaMock.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('normalises the stock of an untracked product to zero and writes no opening movement', async () => {
      prismaMock.product.create.mockResolvedValue(
        buildProduct({
          type: ProductType.PRODUCT,
          stock: 0,
          tracksStock: false,
        }),
      );

      const payload = {
        ...baseCreateDto,
        name: 'PASTILLAS',
        type: ProductType.PRODUCT,
        tracksStock: false,
        stock: 9991,
      };

      await service.create(payload, USER_ID, ORG_ID);

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: ProductType.PRODUCT,
            tracksStock: false,
            stock: 0,
          }),
        }),
      );
      expect(prismaMock.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('keeps tracked merchandise untouched: stock 10 and one opening PURCHASE movement', async () => {
      // Control: tracked merchandise must be unaffected by the boundary.
      prismaMock.product.create.mockResolvedValue(
        buildProduct({
          type: ProductType.PRODUCT,
          stock: 10,
          tracksStock: true,
        }),
      );

      const payload = {
        ...baseCreateDto,
        name: 'PASTILLAS',
        type: ProductType.PRODUCT,
        tracksStock: true,
        stock: 10,
      };

      await service.create(payload, USER_ID, ORG_ID);

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: ProductType.PRODUCT,
            tracksStock: true,
            stock: 10,
          }),
        }),
      );
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PURCHASE',
            quantity: 10,
            previousStock: 0,
            newStock: 10,
          }),
        }),
      );
    });

    it('defaults a missing tracksStock to true, matching the column default', async () => {
      prismaMock.product.create.mockResolvedValue(
        buildProduct({
          type: ProductType.PRODUCT,
          stock: 0,
          tracksStock: true,
        }),
      );

      await service.create(
        { ...baseCreateDto, name: 'PASTILLAS', type: ProductType.PRODUCT },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tracksStock: true }),
        }),
      );
    });
  });

  describe('update', () => {
    it('never moves stock or the kárdex when a service stock is edited', async () => {
      const existingService = buildProduct({
        id: 'serv-1',
        type: ProductType.SERVICE,
        stock: 0,
      });
      prismaMock.product.findFirst
        .mockResolvedValueOnce(existingService)
        .mockResolvedValueOnce(existingService);
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });

      await service.update('serv-1', { stock: 500 }, USER_ID, ORG_ID);

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stock: 0 }),
        }),
      );
      expect(prismaMock.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('records one ADJUSTMENT_OUT when a stocked product is converted into a service', async () => {
      const stockedProduct = buildProduct({
        id: 'prod-1',
        type: ProductType.PRODUCT,
        stock: 9990,
      });
      prismaMock.product.findFirst
        .mockResolvedValueOnce(stockedProduct)
        .mockResolvedValueOnce(
          buildProduct({ type: ProductType.SERVICE, stock: 0 }),
        );
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });

      await service.update(
        'prod-1',
        { type: ProductType.SERVICE },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: ProductType.SERVICE,
            stock: 0,
          }),
        }),
      );
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ADJUSTMENT_OUT',
            quantity: -9990,
            previousStock: 9990,
            newStock: 0,
          }),
        }),
      );
    });

    it('records one ADJUSTMENT_IN when a service is converted back into a stocked product', async () => {
      // The flag must now be declared explicitly: converting back into stocked
      // merchandise is no longer derived from the type alone.
      const existingService = buildProduct({
        id: 'serv-1',
        type: ProductType.SERVICE,
        stock: 0,
      });
      prismaMock.product.findFirst
        .mockResolvedValueOnce(existingService)
        .mockResolvedValueOnce(
          buildProduct({ type: ProductType.PRODUCT, stock: 10 }),
        );
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });

      const payload = {
        type: ProductType.PRODUCT,
        tracksStock: true,
        stock: 10,
      };

      await service.update('serv-1', payload, USER_ID, ORG_ID);

      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ADJUSTMENT_IN',
            quantity: 10,
            previousStock: 0,
            newStock: 10,
          }),
        }),
      );
    });
  });

  describe('untracked merchandise in the update path', () => {
    it('zeroes the stock and records where it went when tracking is turned off', async () => {
      const trackedProduct = buildProduct({
        id: 'prod-1',
        type: ProductType.PRODUCT,
        stock: 40,
        tracksStock: true,
      });
      prismaMock.product.findFirst
        .mockResolvedValueOnce(trackedProduct)
        .mockResolvedValueOnce(
          buildProduct({
            type: ProductType.PRODUCT,
            stock: 0,
            tracksStock: false,
          }),
        );
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });

      const payload = {
        tracksStock: false,
        stock: 500,
      };

      await service.update('prod-1', payload, USER_ID, ORG_ID);

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tracksStock: false,
            stock: 0,
          }),
        }),
      );
      // Turning tracking off drops the stock to zero, so the kárdex has to say where those units
      // went. This is the counterpart of converting a product into a service, which records the
      // same movement; leaving none would recreate the unexplained-stock defect this feature
      // exists to remove.
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ADJUSTMENT_OUT',
            quantity: -40,
            previousStock: 40,
            newStock: 0,
          }),
        }),
      );
    });

    it('converts a service into tracked merchandise when the caller declares tracksStock: true', async () => {
      // Counterpart of the conversion test above: converting a service back into
      // merchandise now requires the caller to declare the flag, because it is
      // explicit rather than derived from the type.
      const existingService = buildProduct({
        id: 'serv-1',
        type: ProductType.SERVICE,
        stock: 0,
        tracksStock: false,
      });
      prismaMock.product.findFirst
        .mockResolvedValueOnce(existingService)
        .mockResolvedValueOnce(
          buildProduct({
            type: ProductType.PRODUCT,
            stock: 10,
            tracksStock: true,
          }),
        );
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });

      const payload = {
        type: ProductType.PRODUCT,
        tracksStock: true,
        stock: 10,
      };

      await service.update('serv-1', payload, USER_ID, ORG_ID);

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tracksStock: true,
            stock: 10,
          }),
        }),
      );
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ADJUSTMENT_IN',
            quantity: 10,
            previousStock: 0,
            newStock: 10,
          }),
        }),
      );
    });

    it('leaves a service untracked when the type changes without the flag', async () => {
      // Intended consequence of making the flag explicit, not an oversight:
      // changing the type alone no longer implies tracked stock.
      const existingService = buildProduct({
        id: 'serv-1',
        type: ProductType.SERVICE,
        stock: 0,
        tracksStock: false,
      });
      prismaMock.product.findFirst
        .mockResolvedValueOnce(existingService)
        .mockResolvedValueOnce(
          buildProduct({
            type: ProductType.PRODUCT,
            stock: 0,
            tracksStock: false,
          }),
        );
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });

      await service.update(
        'serv-1',
        { type: ProductType.PRODUCT },
        USER_ID,
        ORG_ID,
      );

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tracksStock: false,
            stock: 0,
          }),
        }),
      );
      expect(prismaMock.inventoryMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('low-stock surfaces', () => {
    it('excludes services from the paginated low-stock filter', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);
      prismaMock.product.count.mockResolvedValue(0);

      await service.findAll(
        ORG_ID,
        1,
        10,
        undefined,
        undefined,
        'active',
        true,
      );

      const findManyArgs = prismaMock.product.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual(
        expect.objectContaining({
          stock: { lte: MIN_STOCK_FIELD_REF },
          type: ProductType.PRODUCT,
          tracksStock: true,
        }),
      );
    });

    it('excludes services from the raw low-stock lookup', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);

      await service.getLowStockProducts(ORG_ID);

      const sql = (
        prismaMock.$queryRaw.mock.calls[0][0] as unknown as string[]
      ).join('?');
      expect(sql).toContain('p."type"');
      expect(sql).toContain('PRODUCT');
      expect(sql).toContain('p."tracksStock" = true');
    });

    it('never marks a service as low on stock in the search mapper', async () => {
      prismaMock.product.findMany.mockResolvedValue([
        buildProduct({ type: ProductType.SERVICE, stock: 0, minStock: 5 }),
      ]);

      const results = await service.searchProducts('MANTENIMIENTO', 20, ORG_ID);

      expect(results[0].isLowStock).toBe(false);
    });

    it('never marks a service as low on stock in the quick-search mapper', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({ type: ProductType.SERVICE, stock: 0, minStock: 5 }),
      );

      const result = await service.quickSearch('SERV 4', ORG_ID);

      expect(result?.isLowStock).toBe(false);
    });

    it('never marks an untracked product as low on stock in the search mapper', async () => {
      prismaMock.product.findMany.mockResolvedValue([
        buildProduct({
          type: ProductType.PRODUCT,
          tracksStock: false,
          stock: 0,
          minStock: 5,
        }),
      ]);

      const results = await service.searchProducts('PASTILLAS', 20, ORG_ID);

      expect(results[0].isLowStock).toBe(false);
    });

    it('never marks an untracked product as low on stock in the quick-search mapper', async () => {
      prismaMock.product.findFirst.mockResolvedValue(
        buildProduct({
          type: ProductType.PRODUCT,
          tracksStock: false,
          stock: 0,
          minStock: 5,
        }),
      );

      const result = await service.quickSearch('PASTILLAS', ORG_ID);

      expect(result?.isLowStock).toBe(false);
    });
  });
});

// Predicate-aware, commit-on-success model; not PostgreSQL SSI evidence.
describe('ProductsService conversion eligibility', () => {
  const initialProduct = () => ({
    id: 'prod-1',
    organizationId: 'org-1',
    type: ProductType.PRODUCT as ProductType,
    tracksStock: true,
    active: true,
    version: 2,
    stock: 10,
    reservedStock: 0,
    minStock: 1,
    name: 'Equipment',
    salePrice: 100,
    costPrice: 50,
    taxable: false,
    taxRate: 0,
    promotionType: null,
    promotionValue: null,
    barcode: null,
    category: null,
  });
  type Row = ReturnType<typeof initialProduct>;
  type Item = {
    organizationId: string;
    productId: string;
    deliveredQuantity: number;
    returnedQuantity: number;
    cancelledQuantity: number;
    status: string;
  };
  const returnedField = { name: 'returnedQuantity' };
  type Query = {
    where: {
      organizationId: string;
      productId: string;
      deliveredQuantity: { gt: typeof returnedField };
    };
  };
  type Write = {
    where: Partial<Row>;
    data: Omit<Partial<Row>, 'version'> & { version: { increment: number } };
  };
  type Movement = {
    data: {
      productId: string;
      type: string;
      quantity: number;
      previousStock: number;
      newStock: number;
      reason: string;
      userId: string;
      organizationId: string;
      saleId?: string;
    };
  };
  let state: { product: Row; items: Item[]; movements: Movement[] };
  let loseCas: boolean;
  let failMovement: boolean;
  let events: string[];
  const tx = {
    inventoryLoanItem: {
      fields: { returnedQuantity: returnedField },
      findFirst: jest.fn<Promise<Item | null>, [Query]>(),
    },
    product: {
      updateMany: jest.fn<Promise<{ count: number }>, [Write]>(),
      findFirst: jest.fn<Promise<Row>, [unknown]>(),
    },
    inventoryMovement: {
      create: jest.fn<Promise<Movement>, [Movement]>(),
    },
  };
  const prisma = {
    product: {
      findFirst: jest.fn<Promise<Row>, [unknown]>(),
      updateMany: jest.fn<Promise<{ count: number }>, [Write]>(),
    },
    inventoryMovement: {
      create: jest.fn<Promise<Movement>, [Movement]>(),
    },
    $transaction: jest.fn<
      Promise<Row>,
      [(client: typeof tx) => Promise<Row>, unknown]
    >(),
  };
  let service: ProductsService;
  const item = (overrides: Partial<Item> = {}): Item => ({
    organizationId: 'org-1',
    productId: 'prod-1',
    deliveredQuantity: 2,
    returnedQuantity: 0,
    cancelledQuantity: 0,
    status: 'OPEN',
    ...overrides,
  });
  const update = (dto: UpdateProductDto = { type: ProductType.SERVICE }) =>
    service.update('prod-1', dto, 'user-1', 'org-1');

  beforeEach(() => {
    jest.resetAllMocks();
    state = { product: initialProduct(), items: [], movements: [] };
    loseCas = failMovement = false;
    events = [];
    prisma.product.findFirst.mockImplementation(() =>
      Promise.resolve({ ...state.product }),
    );
    // Legacy direct writes really succeed: RED must expose the missing policy.
    prisma.product.updateMany.mockImplementation(({ data }) => {
      state.product = { ...state.product, ...data, version: 3 };
      return Promise.resolve({ count: 1 });
    });
    prisma.inventoryMovement.create.mockImplementation((movement) => {
      state.movements.push(movement);
      return Promise.resolve(movement);
    });
    prisma.$transaction.mockImplementation(async (callback) => {
      const pending = structuredClone(state);
      tx.inventoryLoanItem.findFirst.mockImplementation(({ where }) => {
        events.push('query');
        expect(where.deliveredQuantity.gt).toBe(returnedField);
        return Promise.resolve(
          pending.items.find(
            (entry) =>
              entry.organizationId === where.organizationId &&
              entry.productId === where.productId &&
              entry.deliveredQuantity > entry.returnedQuantity,
          ) ?? null,
        );
      });
      tx.product.updateMany.mockImplementation(({ where, data }) => {
        events.push('cas');
        if (
          loseCas ||
          !Object.entries(where).every(
            ([key, value]) => pending.product[key as keyof Row] === value,
          )
        )
          return Promise.resolve({ count: 0 });
        pending.product = {
          ...pending.product,
          ...data,
          version: pending.product.version + data.version.increment,
        };
        return Promise.resolve({ count: 1 });
      });
      tx.product.findFirst.mockImplementation(() => {
        events.push('read');
        return Promise.resolve({ ...pending.product });
      });
      tx.inventoryMovement.create.mockImplementation((movement) => {
        events.push('movement');
        pending.movements.push(structuredClone(movement));
        if (failMovement) throw new Error('late movement failure');
        return Promise.resolve(movement);
      });
      const result = await callback(tx);
      state = pending;
      return result;
    });
    service = new ProductsService(prisma as never, {} as never, {} as never);
  });

  it('rejects a conversion with zero reservations but outstanding units', async () => {
    state.items = [item()];
    const before = structuredClone(state);
    await expect(update()).rejects.toBeInstanceOf(ConflictException);
    expect(state).toEqual(before);
    expect(events).toEqual(['query']);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it.each<Partial<Item>>([
    { cancelledQuantity: 8 },
    { status: 'CANCELLED' },
    { status: 'CLOSED' },
  ])('does not hide outstanding units with %j', async (overrides) => {
    state.items = [item(overrides)];
    const before = structuredClone(state);
    await expect(update({ tracksStock: false })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(state).toEqual(before);
    expect(events).toEqual(['query']);
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('rejects if any of multiple matching items has outstanding units', async () => {
    state.items = [
      item({ returnedQuantity: 2 }),
      item({ deliveredQuantity: 0 }),
      item(),
    ];
    const before = structuredClone(state);
    await expect(update()).rejects.toBeInstanceOf(ConflictException);
    expect(state).toEqual(before);
    expect(events).toEqual(['query']);
  });

  it.each<Partial<Item>>([
    { organizationId: 'other-org' },
    { productId: 'other-product' },
    { returnedQuantity: 2 },
    { deliveredQuantity: 0 },
  ])('permits conversion for the nonblocking item %j', async (overrides) => {
    state.items = [item(overrides)];
    const result = await update();
    expect(result.type).toBe(ProductType.SERVICE);
    expect(result.tracksStock).toBe(false);
    expect(result.stock).toBe(0);
    expect(result.availableStock).toBeNull();
    expect(state.product.version).toBe(3);
    expect(events).toEqual(['query', 'cas', 'read', 'movement']);
    expect(tx.inventoryLoanItem.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        productId: 'prod-1',
        deliveredQuantity: { gt: returnedField },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(tx.product.updateMany.mock.calls[0][0].where).toEqual({
      id: 'prod-1',
      organizationId: 'org-1',
      version: 2,
      reservedStock: 0,
      active: true,
    });
    expect(tx.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'prod-1', organizationId: 'org-1', active: true },
      include: { category: true },
    });
    expect(state.movements).toEqual([
      {
        data: {
          productId: 'prod-1',
          type: 'ADJUSTMENT_OUT',
          quantity: -10,
          previousStock: 10,
          newStock: 0,
          reason: 'Stock adjustment',
          userId: 'user-1',
          organizationId: 'org-1',
          saleId: undefined,
        },
      },
    ]);
  });

  it.each<UpdateProductDto>([
    { name: 'Renamed' },
    { salePrice: 200 },
    { type: ProductType.PRODUCT },
    { tracksStock: true },
    { type: ProductType.PRODUCT, tracksStock: true },
  ])('keeps ordinary and same-pair edits query-free %j', async (dto) => {
    state.items = [item()];
    await update(dto);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.inventoryLoanItem.findFirst).not.toHaveBeenCalled();
    expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('normalizes an explicit tracking flag before deciding whether to query', async () => {
    state.product = {
      ...state.product,
      type: ProductType.SERVICE,
      tracksStock: false,
      stock: 0,
    };
    state.items = [item()];
    const result = await update({
      type: ProductType.SERVICE,
      tracksStock: true,
    });
    expect(result.tracksStock).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.inventoryLoanItem.findFirst).not.toHaveBeenCalled();
  });

  it('also gates conversion back to tracked merchandise', async () => {
    state.product = {
      ...state.product,
      type: ProductType.SERVICE,
      tracksStock: false,
      stock: 0,
    };
    const result = await update({
      type: ProductType.PRODUCT,
      tracksStock: true,
      stock: 5,
    });
    expect(result.stock).toBe(5);
    expect(events).toEqual(['query', 'cas', 'read', 'movement']);
    expect(state.movements[0].data).toMatchObject({
      type: 'ADJUSTMENT_IN',
      quantity: 5,
      previousStock: 0,
      newStock: 5,
    });
  });

  it.each(['stale version', 'CAS loss'])(
    'rolls back the full cloned state on %s',
    async (failure) => {
      state.items = [item({ returnedQuantity: 2 })];
      if (failure === 'stale version')
        prisma.product.findFirst.mockResolvedValue({
          ...state.product,
          version: 1,
        });
      else loseCas = true;
      const before = structuredClone(state);
      await expect(update()).rejects.toBeInstanceOf(ConflictException);
      expect(state).toEqual(before);
      expect(events).toEqual(['query', 'cas']);
      expect(tx.product.findFirst).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rolls back product, items and movement on a late movement failure', async () => {
    state.items = [item({ returnedQuantity: 2 })];
    failMovement = true;
    const before = structuredClone(state);
    await expect(update()).rejects.toThrow('late movement failure');
    expect(events).toEqual(['query', 'cas', 'read', 'movement']);
    expect(state).toEqual(before);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });
});
