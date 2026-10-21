import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesService } from './sales.service';

describe('SalesService', () => {
  let service: SalesService;
  const stockRow = () => ({ stock: 10, reservedStock: 0, version: 0 });

  // Acting principals for the explicit price-override permission.
  const adminUser = {
    userId: 'user-1',
    email: 'admin@example.com',
    organizationId: 'org-1',
    role: 'ADMIN',
    tokenVersion: 0,
    isSuperAdmin: false,
  } as const;
  const cashierUser = {
    ...adminUser,
    role: 'CASHIER',
  } as const;
  const memberUser = {
    ...adminUser,
    role: 'MEMBER',
  } as const;

  const sequenceServiceMock = {
    nextNumber: jest.fn(),
  };

  const prismaMock = {
    $transaction: jest.fn(),
    organization: {
      findUnique: jest.fn(),
    },
    sale: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
    },
    posLoanSaleIntent: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  const cacheMock = {
    clear: jest.fn(),
  };

  const settingsServiceMock = {
    find: jest.fn(),
  };

  const receiptsServiceMock = {
    generateSaleReceiptPdf: jest.fn(),
  };

  const mockUser = (
    overrides: Partial<{
      userId: string;
      role: 'ADMIN' | 'MEMBER' | 'OWNER' | 'CASHIER';
      organizationId: string;
    }> = {},
  ) => ({
    userId: 'user-1',
    email: 'user@example.com',
    organizationId: 'org-1',
    role: 'MEMBER' as const,
    tokenVersion: 1,
    isSuperAdmin: false,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SalesService(
      prismaMock as never,
      cacheMock as never,
      settingsServiceMock as never,
      sequenceServiceMock as never,
      receiptsServiceMock as never,
    );
  });

  // ---- existing tests preserved ----

  it('applies own-sales scope for MEMBER in list queries', async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        userId: 'cashier-1',
        user: { id: 'cashier-1', name: 'Caja', email: 'caja@example.com' },
        customer: null,
        items: [],
        payments: [],
      },
    ]);
    prismaMock.sale.count.mockResolvedValue(1);

    const result = await service.findAll(
      'org-1',
      1,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockUser({ userId: 'cashier-1', role: 'MEMBER' }),
    );

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'cashier-1',
          organizationId: 'org-1',
        }),
        include: expect.objectContaining({
          user: { select: { id: true, name: true, email: true } },
        }),
      }),
    );
    expect(result.data[0].user).toEqual({
      id: 'cashier-1',
      name: 'Caja',
      email: 'caja@example.com',
    });
  });

  it('applies own-sales scope for CASHIER in list queries', async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        userId: 'cashier-1',
        user: { id: 'cashier-1', name: 'Caja', email: 'caja@example.com' },
        customer: null,
        items: [],
        payments: [],
      },
    ]);
    prismaMock.sale.count.mockResolvedValue(1);

    await service.findAll(
      'org-1',
      1,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockUser({ userId: 'cashier-1', role: 'CASHIER' }),
    );

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'cashier-1',
          organizationId: 'org-1',
        }),
      }),
    );
  });

  it('denies CASHIER access to another seller sale detail', async () => {
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-foreign',
      userId: 'admin-1',
      user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    await expect(
      service.findOne(
        'sale-foreign',
        'org-1',
        mockUser({ userId: 'cashier-1', role: 'CASHIER' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows CASHIER drill-down for own sale detail', async () => {
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-own',
      userId: 'cashier-1',
      user: { id: 'cashier-1', name: 'Caja', email: 'caja@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    await expect(
      service.findOne(
        'sale-own',
        'org-1',
        mockUser({ userId: 'cashier-1', role: 'CASHIER' }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ id: 'sale-own', userId: 'cashier-1' }),
    );
  });

  it('applies customerId filter in list queries', async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        customerId: 'customer-1',
        userId: 'admin-1',
        user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
        customer: { id: 'customer-1', name: 'Ana Perez' },
        items: [],
        payments: [],
      },
    ]);
    prismaMock.sale.count.mockResolvedValue(1);

    await service.findAll(
      'org-1',
      1,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      'customer-1',
      mockUser({ userId: 'admin-1', role: 'ADMIN' }),
    );

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: 'customer-1',
          organizationId: 'org-1',
        }),
      }),
    );
    expect(prismaMock.sale.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        customerId: 'customer-1',
        organizationId: 'org-1',
      }),
    });
  });

  it('combines customerId filter with MEMBER scope', async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        customerId: 'customer-1',
        userId: 'cashier-1',
        user: { id: 'cashier-1', name: 'Caja', email: 'caja@example.com' },
        customer: { id: 'customer-1', name: 'Ana Perez' },
        items: [],
        payments: [],
      },
    ]);
    prismaMock.sale.count.mockResolvedValue(1);

    await service.findAll(
      'org-1',
      1,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      'customer-1',
      mockUser({ userId: 'cashier-1', role: 'MEMBER' }),
    );

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'cashier-1',
          customerId: 'customer-1',
          organizationId: 'org-1',
        }),
      }),
    );
    expect(prismaMock.sale.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'cashier-1',
        customerId: 'customer-1',
        organizationId: 'org-1',
      }),
    });
  });

  it('returns no foreign sales when a customer has no purchases in member scope', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);
    prismaMock.sale.count.mockResolvedValue(0);

    const result = await service.findAll(
      'org-1',
      1,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      'customer-without-sales',
      mockUser({ userId: 'cashier-1', role: 'MEMBER' }),
    );

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'cashier-1',
          customerId: 'customer-without-sales',
          organizationId: 'org-1',
        }),
      }),
    );
    expect(result).toEqual({
      data: [],
      meta: {
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      },
    });
  });

  it('denies MEMBER access to another seller sale detail', async () => {
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-foreign',
      userId: 'admin-1',
      user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    await expect(
      service.findOne(
        'sale-foreign',
        'org-1',
        mockUser({ userId: 'cashier-1', role: 'MEMBER' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[#15] allows MEMBER drill-down for own sale detail', async () => {
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-own',
      userId: 'cashier-1',
      user: { id: 'cashier-1', name: 'Caja', email: 'caja@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    await expect(
      service.findOne(
        'sale-own',
        'org-1',
        mockUser({ userId: 'cashier-1', role: 'MEMBER' }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ id: 'sale-own', userId: 'cashier-1' }),
    );
  });

  it('[#15] allows ADMIN drill-down for any sale detail', async () => {
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-foreign',
      userId: 'cashier-2',
      user: { id: 'cashier-2', name: 'Otra Caja', email: 'otra@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    await expect(
      service.findOne(
        'sale-foreign',
        'org-1',
        mockUser({ userId: 'admin-1', role: 'ADMIN' }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ id: 'sale-foreign', userId: 'cashier-2' }),
    );
  });

  // ---- new tests for T5.1 ----

  it('create uses Serializable transaction and assigns saleNumber from SequenceService', async () => {
    const txMock = {
      sale: { create: jest.fn() },
      saleItem: { create: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(stockRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      payment: { create: jest.fn() },
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown, _options: unknown) => {
        return callback(txMock);
      },
    );

    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 42,
      formatted: '42',
    });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'Test Product',
      active: true,
      salePrice: 100,
      taxable: true,
      taxRate: 19,
      stock: 10,
      category: { taxable: false, defaultTaxRate: null },
    });
    prismaMock.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    txMock.sale.create.mockResolvedValue({ id: 'sale-new', saleNumber: 42 });

    // Mock findOne call inside create
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 42,
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    const createSaleDto = {
      customerId: 'cust-1',
      items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
      discountAmount: 0,
      payments: [{ method: 'CASH' as const, amount: 119 }],
    };

    await service.create(createSaleDto, 'user-1', 'org-1');

    expect(prismaMock.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      }),
    );

    expect(sequenceServiceMock.nextNumber).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'SALE',
      new Date().getFullYear(),
    );

    expect(txMock.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          saleNumber: 42,
          userId: 'user-1',
        }),
      }),
    );
  });

  it('create computes tax via the shared opt-in resolver (taxable product → product rate)', async () => {
    const txMock = {
      sale: { create: jest.fn() },
      saleItem: { create: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(stockRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      payment: { create: jest.fn() },
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(txMock),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 42,
      formatted: '42',
    });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'Taxable Product',
      active: true,
      salePrice: 100,
      taxable: true,
      taxRate: 19,
      stock: 10,
      category: { taxable: false, defaultTaxRate: null },
    });
    prismaMock.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    txMock.sale.create.mockResolvedValue({ id: 'sale-new', saleNumber: 42 });
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 42,
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    await service.create(
      {
        customerId: 'cust-1',
        items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
        discountAmount: 0,
        payments: [{ method: 'CASH' as const, amount: 119 }],
      },
      'user-1',
      'org-1',
    );

    expect(txMock.saleItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taxRate: 19, total: 119 }),
      }),
    );
    expect(txMock.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taxAmount: 19, total: 119 }),
      }),
    );
  });

  it('create falls back to the category rate when the product is not taxable', async () => {
    const txMock = {
      sale: { create: jest.fn() },
      saleItem: { create: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(stockRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      payment: { create: jest.fn() },
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(txMock),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 43,
      formatted: '43',
    });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'Inherited Tax Product',
      active: true,
      salePrice: 100,
      taxable: false,
      taxRate: 0,
      stock: 10,
      category: { taxable: true, defaultTaxRate: 16 },
    });
    prismaMock.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    txMock.sale.create.mockResolvedValue({ id: 'sale-new', saleNumber: 43 });
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 43,
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    await service.create(
      {
        customerId: 'cust-1',
        items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
        discountAmount: 0,
        payments: [{ method: 'CASH' as const, amount: 116 }],
      },
      'user-1',
      'org-1',
    );

    expect(txMock.saleItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taxRate: 16, total: 116 }),
      }),
    );
  });

  it('create honors an ADMIN price override instead of product salePrice, and audits it', async () => {
    const txMock = {
      sale: { create: jest.fn() },
      saleItem: { create: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(stockRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      payment: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(txMock),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 44,
      formatted: '44',
    });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'Price Override Product',
      active: true,
      salePrice: 100,
      taxable: false,
      taxRate: 0,
      stock: 10,
      category: { taxable: false, defaultTaxRate: null },
    });
    prismaMock.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    txMock.sale.create.mockResolvedValue({ id: 'sale-new', saleNumber: 44 });
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 44,
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    await service.create(
      {
        customerId: 'cust-1',
        items: [
          {
            productId: 'prod-1',
            quantity: 1,
            unitPrice: 80,
            discountAmount: 0,
          },
        ],
        discountAmount: 0,
        payments: [{ method: 'CASH' as const, amount: 80 }],
      },
      'user-1',
      'org-1',
      adminUser,
    );

    expect(txMock.saleItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitPrice: 80,
          subtotal: 80,
          total: 80,
        }),
      }),
    );
    expect(txMock.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subtotal: 80, total: 80 }),
      }),
    );
    // The override must leave a trail carrying both prices and the actor.
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'SALE_PRICE_OVERRIDE',
        resource: 'Sale',
        resourceId: 'sale-new',
        organizationId: 'org-1',
        metadata: expect.objectContaining({
          productId: 'prod-1',
          originalUnitPrice: 100,
          overriddenUnitPrice: 80,
          actorRole: 'ADMIN',
        }),
      }),
    });
  });

  it('create persists the authoritative product cost and ignores a client cost snapshot', async () => {
    const txMock = {
      sale: { create: jest.fn() },
      saleItem: { create: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(stockRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      payment: { create: jest.fn() },
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(txMock),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({ number: 45, formatted: '45' });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'Cost Provenance Product',
      active: true,
      costPrice: 37.25,
      salePrice: 80,
      taxable: false,
      taxRate: 0,
      stock: 10,
      category: { taxable: false, defaultTaxRate: null },
    });
    txMock.sale.create.mockResolvedValue({ id: 'sale-new', saleNumber: 45 });
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 45,
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    await service.create(
      {
        items: [
          {
            productId: 'prod-1',
            quantity: 1,
            unitPrice: 80,
            discountAmount: 0,
            costPriceSnapshot: 999,
          },
        ],
        discountAmount: 0,
        payments: [{ method: 'CASH' as const, amount: 80 }],
      } as never,
      'user-1',
      'org-1',
    );

    expect(txMock.saleItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ costPriceSnapshot: 37.25 }),
      }),
    );
    expect(
      txMock.saleItem.create.mock.calls[0][0].data.costPriceSnapshot,
    ).not.toBe(999);
  });

  it('keeps the sale cost snapshot independent from later product cost changes', async () => {
    const txMock = {
      sale: { create: jest.fn() },
      saleItem: { create: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(stockRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      payment: { create: jest.fn() },
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(txMock),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({ number: 46, formatted: '46' });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'Immutable Cost Product',
      active: true,
      costPrice: 37.25,
      salePrice: 80,
      taxable: false,
      taxRate: 0,
      stock: 10,
      category: { taxable: false, defaultTaxRate: null },
    });
    txMock.sale.create.mockResolvedValue({ id: 'sale-new', saleNumber: 46 });
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 46,
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [{ productId: 'prod-1', costPriceSnapshot: 37.25 }],
      payments: [],
    });

    await service.create(
      {
        items: [{ productId: 'prod-1', quantity: 1 }],
        payments: [{ method: 'CASH' as const, amount: 80 }],
      },
      'user-1',
      'org-1',
    );

    const persistedSnapshot = txMock.saleItem.create.mock.calls[0][0].data.costPriceSnapshot;
    expect(persistedSnapshot).toBe(37.25);
    expect(persistedSnapshot).not.toBe(80);
  });

  it('create throws ServiceUnavailableException on P2028 transaction timeout', async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Transaction timeout',
      {
        code: 'P2028',
        clientVersion: '6.0.0',
      },
    );
    prismaMock.$transaction.mockRejectedValue(error);
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'Test Product',
      active: true,
      salePrice: 100,
      taxable: true,
      taxRate: 19,
      stock: 10,
      category: { taxable: false, defaultTaxRate: null },
    });
    prismaMock.customer.findFirst.mockResolvedValue({ id: 'cust-1' });

    const createSaleDto = {
      customerId: 'cust-1',
      items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
      discountAmount: 0,
      payments: [{ method: 'CASH' as const, amount: 119 }],
    };

    await expect(
      service.create(createSaleDto, 'user-1', 'org-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('findOne returns sale scoped by organizationId', async () => {
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-1',
      organizationId: 'org-1',
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    const result = await service.findOne('sale-1', 'org-1');

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sale-1', organizationId: 'org-1' },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: 'sale-1', organizationId: 'org-1' }),
    );
  });

  describe('forceClose', () => {
    it('closes open sale on PRO plan', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ plan: 'PRO' });
      prismaMock.sale.findFirst
        .mockResolvedValueOnce({
          id: 'sale-open',
          status: 'OPEN',
        })
        .mockResolvedValueOnce({
          id: 'sale-open',
          status: 'CLOSED',
          userId: 'user-1',
          user: { id: 'user-1', name: 'User', email: 'user@example.com' },
          customer: null,
          items: [],
          payments: [],
        });
      prismaMock.sale.update.mockResolvedValue({
        id: 'sale-open',
        status: 'CLOSED',
      });

      const result = await service.forceClose(
        'sale-open',
        'org-1',
        'Cierre forzoso',
      );

      expect(prismaMock.sale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sale-open' },
          data: expect.objectContaining({
            status: 'CLOSED',
            cancelReason: 'Cierre forzoso',
          }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ id: 'sale-open', status: 'CLOSED' }),
      );
    });

    it('rejects forceClose on BASIC plan', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ plan: 'BASIC' });

      await expect(
        service.forceClose('sale-open', 'org-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects forceClose if sale is not OPEN', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ plan: 'PRO' });
      prismaMock.sale.findFirst.mockResolvedValue({
        id: 'sale-closed',
        status: 'COMPLETED',
      });

      await expect(
        service.forceClose('sale-closed', 'org-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException if sale does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ plan: 'PRO' });
      prismaMock.sale.findFirst.mockResolvedValue(null);

      await expect(
        service.forceClose('non-existent', 'org-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException if organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.forceClose('sale-open', 'org-missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('update validates ownership with organizationId and applies cancel fields', async () => {
    const txMock = {
      product: {
        findFirst: jest.fn().mockResolvedValue({ ...stockRow(), stock: 5 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    prismaMock.sale.findFirst
      .mockResolvedValueOnce({
        id: 'sale-1',
        status: 'COMPLETED',
        userId: 'user-1',
        organizationId: 'org-1',
        saleNumber: 10,
        items: [
          {
            id: 'si-1',
            productId: 'prod-1',
            quantity: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'sale-1',
        status: 'CANCELLED',
        userId: 'user-1',
        organizationId: 'org-1',
        saleNumber: 10,
        cancelledAt: new Date(),
        cancelledById: 'user-1',
        cancelReason: 'Cliente arrepentido',
        items: [],
        payments: [],
        customer: null,
        user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      });

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return callback(txMock);
      },
    );

    const result = await service.update(
      'sale-1',
      { status: 'CANCELLED', cancelReason: 'Cliente arrepentido' },
      'user-1',
      'org-1',
    );

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sale-1', organizationId: 'org-1' },
      }),
    );

    expect(txMock.sale.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelledAt: expect.any(Date),
          cancelledById: 'user-1',
          cancelReason: 'Cliente arrepentido',
        }),
      }),
    );
  });

  describe('create promotion pricing', () => {
    const promoProduct = {
      id: 'prod-1',
      name: 'Promo Product',
      active: true,
      costPrice: 5000,
      salePrice: 10000,
      taxable: false,
      taxRate: 0,
      stock: 10,
      category: { taxable: false, defaultTaxRate: null },
      promotionType: 'PERCENTAGE',
      promotionValue: 20,
    };

    const buildTx = () => ({
      sale: { create: jest.fn() },
      saleItem: { create: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(stockRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      payment: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    });

    const primeCreate = (
      tx: ReturnType<typeof buildTx>,
      product: Record<string, unknown>,
      saleNumber: number,
    ) => {
      prismaMock.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) => callback(tx),
      );
      sequenceServiceMock.nextNumber.mockResolvedValue({
        number: saleNumber,
        formatted: String(saleNumber),
      });
      prismaMock.product.findFirst.mockResolvedValue(product);
      tx.sale.create.mockResolvedValue({ id: 'sale-new', saleNumber });
      prismaMock.sale.findFirst.mockResolvedValue({
        id: 'sale-new',
        saleNumber,
        userId: 'user-1',
        user: { id: 'user-1', name: 'User', email: 'user@example.com' },
        customer: null,
        items: [],
        payments: [],
      });
    };

    it('falls back to the promotional effective price when the client omits unitPrice', async () => {
      const tx = buildTx();
      primeCreate(tx, promoProduct, 50);

      await service.create(
        {
          items: [{ productId: 'prod-1', quantity: 2, discountAmount: 0 }],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 16000 }],
        },
        'user-1',
        'org-1',
      );

      expect(tx.saleItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unitPrice: 8000, subtotal: 16000 }),
        }),
      );
      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 16000 }),
        }),
      );
    });

    it('snapshots the promotional unit price at creation time (historical immutability)', async () => {
      const tx = buildTx();
      const product = { ...promoProduct };
      primeCreate(tx, product, 51);

      await service.create(
        {
          items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 8000 }],
        },
        'user-1',
        'org-1',
      );

      // Later promo removal must not mutate the already-persisted SaleItem.
      product.promotionType = null;
      product.promotionValue = null;
      product.salePrice = 12000;

      const persisted = tx.saleItem.create.mock.calls[0][0].data;
      expect(persisted.unitPrice).toBe(8000);
      expect(persisted.subtotal).toBe(8000);
      expect(persisted.total).toBe(8000);
    });

    it('honors an ADMIN unitPrice override even with an active promotion', async () => {
      const tx = buildTx();
      primeCreate(tx, promoProduct, 52);

      await service.create(
        {
          items: [
            {
              productId: 'prod-1',
              quantity: 1,
              unitPrice: 9000,
              discountAmount: 0,
            },
          ],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 9000 }],
        },
        'user-1',
        'org-1',
        adminUser,
      );

      expect(tx.saleItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unitPrice: 9000, subtotal: 9000 }),
        }),
      );
      // Original price recorded is the PROMOTIONAL one the server derived,
      // not the list price.
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'SALE_PRICE_OVERRIDE',
          metadata: expect.objectContaining({
            originalUnitPrice: 8000,
            overriddenUnitPrice: 9000,
          }),
        }),
      });
    });

    it('rejects a MEMBER echoing the list price instead of the promotional price', async () => {
      // The server derives 8000 from the PERCENTAGE 20 promotion;
      // a MEMBER cannot override it by echoing the list price.
      const tx = buildTx();
      primeCreate(tx, promoProduct, 55);

      await expect(
        service.create(
          {
            items: [
              {
                productId: 'prod-1',
                quantity: 1,
                unitPrice: 10000,
                discountAmount: 0,
              },
            ],
            discountAmount: 0,
            payments: [{ method: 'CASH' as const, amount: 10000 }],
          },
          'user-1',
          'org-1',
          memberUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    it('charges the promotional price when the client sends no price at all', async () => {
      const tx = buildTx();
      primeCreate(tx, promoProduct, 56);

      await service.create(
        {
          items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 8000 }],
        },
        'user-1',
        'org-1',
        cashierUser,
      );

      expect(tx.saleItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unitPrice: 8000, subtotal: 8000 }),
        }),
      );
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('stacks the manual rebate on the offer price and floors the item total at zero', async () => {
      const tx = buildTx();
      primeCreate(tx, promoProduct, 53);

      await service.create(
        {
          items: [{ productId: 'prod-1', quantity: 1, discountAmount: 8000 }],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 0 }],
        },
        'user-1',
        'org-1',
      );

      const persisted = tx.saleItem.create.mock.calls[0][0].data;
      expect(persisted.unitPrice).toBe(8000);
      expect(persisted.discountAmount).toBe(8000);
      expect(persisted.subtotal).toBe(0);
      expect(persisted.total).toBe(0);
      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 0, total: 0 }),
        }),
      );
    });

    it('rejects an item discount greater than the offer gross subtotal', async () => {
      const tx = buildTx();
      primeCreate(tx, promoProduct, 54);

      await expect(
        service.create(
          {
            items: [{ productId: 'prod-1', quantity: 1, discountAmount: 8000.01 }],
            discountAmount: 0,
            payments: [{ method: 'CASH' as const, amount: 8000 }],
          },
          'user-1',
          'org-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create price override authorization', () => {
    // A plain product, no promotion: the server price is the list price, so
    // any deviation the client asks for is unambiguously an override.
    const plainProduct = {
      id: 'prod-1',
      name: 'Plain Product',
      active: true,
      costPrice: 5000,
      salePrice: 100000,
      taxable: false,
      taxRate: 0,
      stock: 10,
      category: { taxable: false, defaultTaxRate: null },
    };

    const buildTx = () => ({
      sale: { create: jest.fn() },
      saleItem: { create: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(stockRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      payment: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    });

    const primeCreate = (tx: ReturnType<typeof buildTx>) => {
      prismaMock.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) => callback(tx),
      );
      sequenceServiceMock.nextNumber.mockResolvedValue({
        number: 60,
        formatted: '60',
      });
      prismaMock.product.findFirst.mockResolvedValue(plainProduct);
      tx.sale.create.mockResolvedValue({ id: 'sale-new', saleNumber: 60 });
      prismaMock.sale.findFirst.mockResolvedValue({
        id: 'sale-new',
        saleNumber: 60,
        userId: 'user-1',
        user: { id: 'user-1', name: 'User', email: 'user@example.com' },
        customer: null,
        items: [],
        payments: [],
      });
    };

    const dtoWithPrice = (unitPrice?: number) => ({
      items: [
        { productId: 'prod-1', quantity: 1, unitPrice, discountAmount: 0 },
      ],
      discountAmount: 0,
      payments: [{ method: 'CASH' as const, amount: unitPrice ?? 100000 }],
    });

    it('rejects a MEMBER override (MEMBER is not a manager)', async () => {
      const tx = buildTx();
      primeCreate(tx);

      await expect(
        service.create(dtoWithPrice(1), 'user-1', 'org-1', memberUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    it('rejects an override when no acting principal is supplied at all', async () => {
      const tx = buildTx();
      primeCreate(tx);

      await expect(
        service.create(dtoWithPrice(1), 'user-1', 'org-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    it.each([adminUser, cashierUser])('accepts a $role override down to 0 and audits original + new + actor', async (actor) => {
      const tx = buildTx();
      primeCreate(tx);

      await service.create(dtoWithPrice(0), 'user-1', 'org-1', actor);

      expect(tx.saleItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unitPrice: 0,
            subtotal: 0,
            total: 0,
          }),
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      const auditRow = tx.auditLog.create.mock.calls[0][0].data;
      expect(auditRow.userId).toBe('user-1');
      expect(auditRow.action).toBe('SALE_PRICE_OVERRIDE');
      expect(auditRow.resource).toBe('Sale');
      expect(auditRow.resourceId).toBe('sale-new');
      expect(auditRow.organizationId).toBe('org-1');
      expect(auditRow.metadata).toMatchObject({
        saleId: 'sale-new',
        productId: 'prod-1',
        productName: 'Plain Product',
        quantity: 1,
        originalUnitPrice: 100000,
        overriddenUnitPrice: 0,
        actorRole: actor.role,
      });
    });

    it('writes no audit row when the client price matches the server price', async () => {
      const tx = buildTx();
      primeCreate(tx);

      await service.create(
        dtoWithPrice(100000),
        'user-1',
        'org-1',
        cashierUser,
      );

      expect(tx.saleItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unitPrice: 100000 }),
        }),
      );
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('writes no audit row when the client omits the price entirely', async () => {
      const tx = buildTx();
      primeCreate(tx);

      await service.create(
        dtoWithPrice(undefined),
        'user-1',
        'org-1',
        cashierUser,
      );

      expect(tx.saleItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unitPrice: 100000 }),
        }),
      );
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it.each([100000 + 0.005, 100000 - 0.005])(
      'persists the server price without an override audit for float noise at %p',
      async (requestedUnitPrice) => {
        const tx = buildTx();
        primeCreate(tx);

        // Cover both sides of the tolerance without an underpayment failure.
        await service.create(
          {
            ...dtoWithPrice(requestedUnitPrice),
            payments: [{ method: 'CASH' as const, amount: 100001 }],
          },
          'user-1',
          'org-1',
          cashierUser,
        );

        expect(tx.saleItem.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              unitPrice: 100000,
              subtotal: 100000,
              total: 100000,
            }),
          }),
        );
        expect(tx.auditLog.create).not.toHaveBeenCalled();
      },
    );

    it('rejects a negative override for an ADMIN (defensive, past the DTO)', async () => {
      const tx = buildTx();
      primeCreate(tx);

      await expect(
        service.create(
          {
            items: [
              {
                productId: 'prod-1',
                quantity: 1,
                unitPrice: -50,
                discountAmount: 0,
              },
            ],
            discountAmount: 0,
            payments: [{ method: 'CASH' as const, amount: 0 }],
          } as never,
          'user-1',
          'org-1',
          adminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    it('audits each overridden line separately on a multi-line sale', async () => {
      const tx = buildTx();
      primeCreate(tx);
      prismaMock.product.findFirst
        .mockResolvedValueOnce(plainProduct)
        .mockResolvedValueOnce({
          ...plainProduct,
          id: 'prod-2',
          name: 'Second',
          salePrice: 50000,
        });

      await service.create(
        {
          items: [
            {
              productId: 'prod-1',
              quantity: 1,
              unitPrice: 90000,
              discountAmount: 0,
            },
            {
              productId: 'prod-2',
              quantity: 1,
              unitPrice: 40000,
              discountAmount: 0,
            },
          ],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 130000 }],
        },
        'user-1',
        'org-1',
        adminUser,
      );

      expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
      expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({
        productId: 'prod-1',
        originalUnitPrice: 100000,
        overriddenUnitPrice: 90000,
      });
      expect(tx.auditLog.create.mock.calls[1][0].data.metadata).toMatchObject({
        productId: 'prod-2',
        originalUnitPrice: 50000,
        overriddenUnitPrice: 40000,
      });
    });
  });
});

describe('SalesService.generateReceipt delegation', () => {
  const prismaMock = {
    sale: {
      findFirst: jest.fn(),
    },
  };

  const cacheMock = { clear: jest.fn() };
  const settingsServiceMock = { find: jest.fn() };
  const sequenceServiceMock = { nextNumber: jest.fn() };
  const receiptsServiceMock = { generateSaleReceiptPdf: jest.fn() };

  const mockUser = () => ({
    userId: 'user-1',
    email: 'user@example.com',
    organizationId: 'org-1',
    role: 'MEMBER' as const,
    tokenVersion: 1,
    isSuperAdmin: false,
  });

  const service = new SalesService(
    prismaMock as never,
    cacheMock as never,
    settingsServiceMock as never,
    sequenceServiceMock as never,
    receiptsServiceMock as never,
  );

  const receiptSale = {
    id: 'sale-1',
    saleNumber: 42,
    userId: 'user-1',
    customer: { name: 'Ana María Torres' },
    items: [],
    payments: [],
  };

  const receiptSettings = {
    organization: { name: 'Tienda Test', logoUrl: null },
    invoicing: { printHeader: '', printFooter: '' },
    receipt: { prefix: 'REC' },
  };

  const stubResponse = () => {
    const headers: Record<string, string> = {};
    let sent: Buffer | undefined;
    return {
      headers,
      get sent() {
        return sent;
      },
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      send: (body: Buffer) => {
        sent = body;
      },
    };
  };

  it('delegates PDF generation to ReceiptsService with the sale and settings', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(receiptSale);
    settingsServiceMock.find.mockResolvedValue(receiptSettings);
    const pdf = Buffer.from('%PDF-delegate');
    receiptsServiceMock.generateSaleReceiptPdf.mockResolvedValue(pdf);
    const response = stubResponse();

    await service.generateReceipt('sale-1', response as never, mockUser());

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sale-1', organizationId: 'org-1' },
      }),
    );
    expect(settingsServiceMock.find).toHaveBeenCalledWith('org-1');
    expect(receiptsServiceMock.generateSaleReceiptPdf).toHaveBeenCalledWith(
      receiptSale,
      receiptSettings,
    );
    expect(response.sent).toBe(pdf);
  });

  it('keeps the PDF download response headers', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(receiptSale);
    settingsServiceMock.find.mockResolvedValue(receiptSettings);
    receiptsServiceMock.generateSaleReceiptPdf.mockReturnValue(
      Buffer.from('%PDF-headers'),
    );
    const response = stubResponse();

    await service.generateReceipt('sale-1', response as never, mockUser());

    expect(response.headers['Content-Type']).toBe('application/pdf');
    expect(response.headers['Content-Disposition']).toBe(
      'attachment; filename=comprobante_42.pdf',
    );
  });
});
