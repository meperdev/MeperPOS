import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesService } from './sales.service';

describe('SalesService', () => {
  let service: SalesService;
  const stockRow = () => ({ stock: 10, reservedStock: 0, version: 0 });
  // The instant Prisma reports for the row it just wrote; the fiscal snapshot
  // records it instead of inventing a second clock read.
  const saleIssuedAt = new Date('2026-11-04T15:20:31.000Z');

  // T4c: a sale registers its fiscal document inside the same transaction, so
  // every sale-transaction mock has to expose the two delegates that write path
  // touches: the issuer read (NIT + activation) and the fiscal document insert.
  // Spec S9: the organization carries the activation decision, so the default
  // here is an activated pilot organization.
  const fiscalDelegates = () => ({
    organization: {
      findFirst: jest.fn().mockResolvedValue({
        taxId: '900123456',
        settings: { electronicInvoicing: { enabled: true } },
      }),
    },
    fiscalDocument: { create: jest.fn().mockResolvedValue({ id: 'fiscal-1' }) },
  });

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
      ...fiscalDelegates(),
      saleItem: { create: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(stockRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryMovement: { create: jest.fn() },
      payment: { create: jest.fn() },
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
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
    txMock.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 42,
      createdAt: saleIssuedAt,
    });

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
      ...fiscalDelegates(),
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
    txMock.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 42,
      createdAt: saleIssuedAt,
    });
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
      ...fiscalDelegates(),
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
    txMock.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 43,
      createdAt: saleIssuedAt,
    });
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

  // T4b: the per-line fiscal facts are written with the same transaction that
  // writes the line, so a CUFE or an XML built from the sale can never see a
  // code that the sale does not have.
  const persistableTxMock = () => ({
    sale: { create: jest.fn() },
    ...fiscalDelegates(),
    saleItem: { create: jest.fn() },
    product: {
      findFirst: jest.fn().mockResolvedValue(stockRow()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryMovement: { create: jest.fn() },
    payment: { create: jest.fn() },
  });

  const runCreate = async (
    txMock: ReturnType<typeof persistableTxMock>,
    product: Record<string, unknown>,
    amount: number,
    items: Array<{
      productId: string;
      quantity: number;
      discountAmount: number;
    }> = [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
  ) => {
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(txMock),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 45,
      formatted: '45',
    });
    prismaMock.product.findFirst.mockResolvedValue(product);
    prismaMock.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    txMock.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 45,
      createdAt: saleIssuedAt,
    });
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
        customerId: 'cust-1',
        items,
        discountAmount: 0,
        payments: [{ method: 'CASH' as const, amount }],
      },
      'user-1',
      'org-1',
    );
  };

  it('rounds each line before summing so Sale.taxAmount matches the persisted lines', async () => {
    const txMock = persistableTxMock();

    // Two lines whose tax is 0.005 each: the raw sum is 0.01 but each line
    // stores 0.01, so the persisted lines add up to 0.02. Sale.taxAmount must
    // agree with them, because the CUFE and the XML sum the persisted rows.
    await runCreate(
      txMock,
      {
        id: 'prod-1',
        name: 'Fractional Product',
        active: true,
        salePrice: 0.1,
        taxable: true,
        taxRate: 5,
        taxCode: 'IVA',
        stock: 10,
        category: {
          taxable: false,
          defaultTaxRate: null,
          defaultTaxCode: null,
        },
      },
      0.22,
      [
        { productId: 'prod-1', quantity: 1, discountAmount: 0 },
        { productId: 'prod-1', quantity: 1, discountAmount: 0 },
      ],
    );

    expect(txMock.saleItem.create).toHaveBeenCalledTimes(2);
    for (const call of txMock.saleItem.create.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({ taxAmount: 0.01 }),
        }),
      );
    }
    expect(txMock.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taxAmount: 0.02 }),
      }),
    );
  });

  it('create persists the resolved tax code and tax amount per line', async () => {
    const txMock = persistableTxMock();

    await runCreate(
      txMock,
      {
        id: 'prod-1',
        name: 'INC Product',
        active: true,
        salePrice: 100,
        taxable: true,
        taxRate: 5,
        taxCode: 'INC',
        stock: 10,
        category: { taxable: true, defaultTaxRate: 10, defaultTaxCode: null },
      },
      105,
    );

    expect(txMock.saleItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taxRate: 5,
          taxCode: 'INC',
          taxAmount: 5,
        }),
      }),
    );
  });

  it('create persists no code and no amount for an untaxed line', async () => {
    const txMock = persistableTxMock();

    await runCreate(
      txMock,
      {
        id: 'prod-1',
        name: 'Untaxed Product',
        active: true,
        salePrice: 100,
        taxable: false,
        taxRate: 0,
        taxCode: 'ICA',
        stock: 10,
        category: {
          taxable: false,
          defaultTaxRate: null,
          defaultTaxCode: 'ICA',
        },
      },
      100,
    );

    expect(txMock.saleItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taxCode: null, taxAmount: null }),
      }),
    );
  });

  it('create honors an ADMIN price override instead of product salePrice, and audits it', async () => {
    const txMock = {
      sale: { create: jest.fn() },
      ...fiscalDelegates(),
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
    txMock.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 44,
      createdAt: saleIssuedAt,
    });
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
      ...fiscalDelegates(),
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
      number: 45,
      formatted: '45',
    });
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
    txMock.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 45,
      createdAt: saleIssuedAt,
    });
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
      ...fiscalDelegates(),
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
      number: 46,
      formatted: '46',
    });
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
    txMock.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 46,
      createdAt: saleIssuedAt,
    });
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

    const persistedSnapshot =
      txMock.saleItem.create.mock.calls[0][0].data.costPriceSnapshot;
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
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
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

    await service.update(
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
      promotionType: 'PERCENTAGE' as string | null,
      promotionValue: 20 as number | null,
    };

    const buildTx = () => ({
      sale: { create: jest.fn() },
      ...fiscalDelegates(),
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
      tx.sale.create.mockResolvedValue({
        id: 'sale-new',
        saleNumber,
        createdAt: saleIssuedAt,
      });
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
            items: [
              { productId: 'prod-1', quantity: 1, discountAmount: 8000.01 },
            ],
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
      ...fiscalDelegates(),
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
      tx.sale.create.mockResolvedValue({
        id: 'sale-new',
        saleNumber: 60,
        createdAt: saleIssuedAt,
      });
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

    it.each([adminUser, cashierUser])(
      'accepts a $role override down to 0 and audits original + new + actor',
      async (actor) => {
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
      },
    );

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

// T4c: a sale registers its fiscal document in the same transaction that
// registers the sale, for every payment method, and the document is PENDING
// with no CUFE (the technical key is not available, spec S6).
describe('SalesService fiscal document emission', () => {
  const issuedAt = new Date('2026-11-04T15:20:31.000Z');

  const taxableProduct = {
    id: 'prod-1',
    name: 'Taxable Product',
    type: 'PRODUCT' as const,
    tracksStock: true,
    active: true,
    costPrice: 50,
    salePrice: 100,
    taxable: true,
    taxRate: 19,
    taxCode: 'IVA' as const,
    stock: 10,
    category: { taxable: false, defaultTaxRate: null, defaultTaxCode: null },
  };

  const prismaMock = {
    $transaction: jest.fn(),
    sale: { findFirst: jest.fn() },
    product: { findFirst: jest.fn() },
    customer: { findFirst: jest.fn() },
  };
  const cacheMock = { clear: jest.fn() };
  const settingsServiceMock = { find: jest.fn() };
  const sequenceServiceMock = { nextNumber: jest.fn() };
  const receiptsServiceMock = { generateSaleReceiptPdf: jest.fn() };

  const service = new SalesService(
    prismaMock as never,
    cacheMock as never,
    settingsServiceMock as never,
    sequenceServiceMock as never,
    receiptsServiceMock as never,
  );

  const buildTx = () => ({
    sale: { create: jest.fn() },
    saleItem: { create: jest.fn() },
    product: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ stock: 10, reservedStock: 0, version: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryMovement: { create: jest.fn() },
    payment: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    organization: {
      findFirst: jest.fn().mockResolvedValue({
        taxId: '900123456',
        settings: { electronicInvoicing: { enabled: true } },
      }),
    },
    fiscalDocument: { create: jest.fn().mockResolvedValue({ id: 'fiscal-1' }) },
  });

  type Tx = ReturnType<typeof buildTx>;

  const prime = (options: { customer?: boolean } = {}): Tx => {
    const tx = buildTx();
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: unknown) => unknown) => callback(tx),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 77,
      formatted: 'SETP-77',
    });
    prismaMock.product.findFirst.mockResolvedValue(taxableProduct);
    prismaMock.customer.findFirst.mockResolvedValue(
      options.customer
        ? {
            id: 'cust-1',
            name: 'Cliente',
            documentType: 'NIT',
            documentNumber: '900.111.222-3',
          }
        : null,
    );
    tx.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 77,
      createdAt: issuedAt,
      subtotal: new Prisma.Decimal('100.00'),
      taxAmount: new Prisma.Decimal('19.00'),
      discountAmount: new Prisma.Decimal('0.00'),
      total: new Prisma.Decimal('119.00'),
      amountPaid: new Prisma.Decimal('119.00'),
      change: null,
    });
    tx.saleItem.create.mockImplementation((args: { data: object }) =>
      Promise.resolve({ id: 'item-1', ...args.data }),
    );
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 77,
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [],
      payments: [],
    });
    return tx;
  };

  const dto = (
    method: 'CASH' | 'CARD' | 'TRANSFER' = 'CASH',
    customerId?: string,
  ) => ({
    customerId,
    items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
    discountAmount: 0,
    payments: [{ method, amount: 119 }],
  });

  const fiscalPayload = (tx: Tx) =>
    tx.fiscalDocument.create.mock.calls[0][0].data;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a PENDING fiscal document inside the sale transaction', async () => {
    const tx = prime();

    await service.create(dto(), 'user-1', 'org-1');

    expect(tx.fiscalDocument.create).toHaveBeenCalledTimes(1);
    expect(fiscalPayload(tx)).toMatchObject({
      organizationId: 'org-1',
      saleId: 'sale-new',
      status: 'PENDING',
      issuedAt,
    });
    // Transactional only: there is no outside-the-transaction write path.
    expect(
      (prismaMock as unknown as Record<string, unknown>).fiscalDocument,
    ).toBeUndefined();
    expect(prismaMock.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('snapshots the persisted money and the fiscal facts of every line', async () => {
    const tx = prime();

    await service.create(dto(), 'user-1', 'org-1');

    expect(fiscalPayload(tx).snapshot).toEqual({
      version: 1,
      saleId: 'sale-new',
      saleNumber: 77,
      organizationId: 'org-1',
      issuedAt: '2026-11-04T15:20:31.000Z',
      currency: 'COP',
      issuerTaxId: '900123456',
      buyerTaxId: null,
      lineExtensionAmount: '100.00',
      taxAmount: '19.00',
      discountAmount: '0.00',
      payableAmount: '119.00',
      amountPaid: '119.00',
      change: null,
      lines: [
        {
          lineNumber: 1,
          productId: 'prod-1',
          quantity: 1,
          unitPrice: '100.00',
          discountAmount: '0.00',
          subtotal: '100.00',
          taxRate: '19.00',
          taxCode: 'IVA',
          taxAmount: '19.00',
          total: '119.00',
        },
      ],
    });
  });

  it('snapshots the buyer identification when the sale has a customer', async () => {
    const tx = prime({ customer: true });

    await service.create(dto('CASH', 'cust-1'), 'user-1', 'org-1');

    expect(fiscalPayload(tx).snapshot).toMatchObject({
      issuerTaxId: '900123456',
      buyerTaxId: '900.111.222-3',
    });
  });

  it.each(['CASH', 'CARD', 'TRANSFER'] as const)(
    'registers the same fiscal document for a %s sale: the payment state never moves the fiscal moment',
    async (method) => {
      const tx = prime();

      await service.create(dto(method), 'user-1', 'org-1');

      expect(tx.fiscalDocument.create).toHaveBeenCalledTimes(1);
      expect(fiscalPayload(tx).snapshot).toMatchObject({
        payableAmount: '119.00',
        lineExtensionAmount: '100.00',
      });
    },
  );

  it('writes no CUFE: the technical key is not available (S6)', async () => {
    const tx = prime();

    await service.create(dto(), 'user-1', 'org-1');

    const payload = fiscalPayload(tx);
    expect(payload.cufe ?? null).toBeNull();
    expect(Object.keys(payload.snapshot as object)).not.toContain('cufe');
  });

  it('records a null issuer identification when the organization has no NIT', async () => {
    const tx = prime();
    tx.organization.findFirst.mockResolvedValue({
      taxId: null,
      settings: { electronicInvoicing: { enabled: true } },
    });

    await service.create(dto(), 'user-1', 'org-1');

    expect(fiscalPayload(tx).snapshot).toMatchObject({ issuerTaxId: null });
  });

  // Spec S9 — «solo para quienes la tienen activa»: no local fiscal record is
  // written for an organization that has not activated electronic invoicing.
  // The ordinary sale is unchanged; nothing in it may depend on the flag.
  it('writes no fiscal document when the organization has not activated electronic invoicing', async () => {
    const tx = prime();
    tx.organization.findFirst.mockResolvedValue({
      taxId: '900123456',
      settings: {},
    });

    const sale = await service.create(dto(), 'user-1', 'org-1');

    expect(sale).toMatchObject({ id: 'sale-new', saleNumber: 77 });
    expect(tx.saleItem.create).toHaveBeenCalledTimes(1);
    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  it('reads the activation flag and the issuer NIT inside the sale transaction', async () => {
    const tx = prime();

    await service.create(dto(), 'user-1', 'org-1');

    expect(tx.organization.findFirst).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { settings: true, taxId: true },
    });
  });

  it('does not leave a registered sale without its fiscal document', async () => {
    const tx = prime();
    tx.fiscalDocument.create.mockRejectedValue(
      new Error('fiscal insert failed'),
    );

    await expect(service.create(dto(), 'user-1', 'org-1')).rejects.toThrow(
      'fiscal insert failed',
    );
    expect(prismaMock.sale.findFirst).not.toHaveBeenCalled();
    expect(cacheMock.clear).not.toHaveBeenCalled();
  });

  // T4d (L72): the shared cash rounding must not change. This line's tax is the
  // float 0.40499999999999997, whose product by 100 is exactly 40.5, so the
  // established answer is 0.41. Re-deriving the decimal value of the float gives
  // 0.40 and silently moves a cent out of every such sale.
  const halfCentProduct = {
    ...taxableProduct,
    salePrice: 0.09,
    taxRate: 4.5,
    taxCode: 'IVA' as const,
  };
  const halfCentDto = () => ({
    customerId: 'cust-1',
    items: [{ productId: 'prod-1', quantity: 100, discountAmount: 0 }],
    discountAmount: 0,
    payments: [{ method: 'CASH' as const, amount: 9.41 }],
  });

  it('keeps the historical float rounding of a half-cent line when invoicing is active', async () => {
    const tx = prime({ customer: true });
    prismaMock.product.findFirst.mockResolvedValue(halfCentProduct);
    tx.product.findFirst.mockResolvedValue({
      stock: 200,
      reservedStock: 0,
      version: 0,
    });

    await service.create(halfCentDto(), 'user-1', 'org-1');

    expect(tx.saleItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taxAmount: 0.41 }),
      }),
    );
    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 9,
          taxAmount: 0.41,
          total: 9.41,
        }),
      }),
    );
    expect(fiscalPayload(tx).snapshot).toMatchObject({
      lineExtensionAmount: '9.00',
      taxAmount: '0.41',
      payableAmount: '9.41',
    });
  });

  it('keeps the same float rounding when invoicing is not active and writes no document', async () => {
    const tx = prime({ customer: true });
    prismaMock.product.findFirst.mockResolvedValue(halfCentProduct);
    tx.product.findFirst.mockResolvedValue({
      stock: 200,
      reservedStock: 0,
      version: 0,
    });
    tx.organization.findFirst.mockResolvedValue({
      taxId: null,
      settings: {},
    });

    await service.create(halfCentDto(), 'user-1', 'org-1');

    expect(tx.saleItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taxAmount: 0.41 }),
      }),
    );
    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taxAmount: 0.41, total: 9.41 }),
      }),
    );
    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // A sale-wide discount with a fraction of a cent is stored as one cent while
  // the payable keeps its own rounding, so an activated organization would
  // record a document that contradicts itself (9.99 against a 10.00 payable).
  const fractionalDiscountDto = () => ({
    customerId: 'cust-1',
    items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
    discountAmount: 0.005,
    payments: [{ method: 'CASH' as const, amount: 10 }],
  });
  const untaxedTenProduct = {
    ...taxableProduct,
    salePrice: 10,
    taxable: false,
    taxRate: 0,
    taxCode: null,
  };

  it('refuses to snapshot an activated sale whose fractional-cent discount breaks its money', async () => {
    const tx = prime({ customer: true });
    prismaMock.product.findFirst.mockResolvedValue(untaxedTenProduct);

    await expect(
      service.create(fractionalDiscountDto(), 'user-1', 'org-1'),
    ).rejects.toThrow(ConflictException);

    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // The same class of break at the line level: two lines of 99.995 are stored as
  // 100.00 each while the header subtotal keeps 199.99, so the document's lines
  // would not support its own line extension amount.
  const fractionalLineDiscountDto = () => ({
    customerId: 'cust-1',
    items: [
      { productId: 'prod-1', quantity: 1, discountAmount: 0.005 },
      { productId: 'prod-1', quantity: 1, discountAmount: 0.005 },
    ],
    discountAmount: 0,
    payments: [{ method: 'CASH' as const, amount: 19.99 }],
  });

  it('refuses an activated sale whose line rounding disagrees with its header', async () => {
    const tx = prime({ customer: true });
    prismaMock.product.findFirst.mockResolvedValue(untaxedTenProduct);

    await expect(
      service.create(fractionalLineDiscountDto(), 'user-1', 'org-1'),
    ).rejects.toThrow(ConflictException);

    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  it('keeps that fractional-cent line discount unchanged when invoicing is not active', async () => {
    const tx = prime({ customer: true });
    prismaMock.product.findFirst.mockResolvedValue(untaxedTenProduct);
    tx.organization.findFirst.mockResolvedValue({
      taxId: null,
      settings: {},
    });

    await service.create(fractionalLineDiscountDto(), 'user-1', 'org-1');

    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subtotal: 19.99, total: 19.99 }),
      }),
    );
    expect(tx.saleItem.create).toHaveBeenCalledTimes(2);
    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  it('registers that fractional-cent discount unchanged when invoicing is not active', async () => {
    const tx = prime({ customer: true });
    prismaMock.product.findFirst.mockResolvedValue(untaxedTenProduct);
    tx.organization.findFirst.mockResolvedValue({
      taxId: null,
      settings: {},
    });

    await service.create(fractionalDiscountDto(), 'user-1', 'org-1');

    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 10,
          discountAmount: 0.005,
          total: 9.995,
        }),
      }),
    );
    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
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
      { ...receiptSale, financed: false },
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
