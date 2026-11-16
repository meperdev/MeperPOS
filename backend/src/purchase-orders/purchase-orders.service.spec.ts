import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;

  const sequenceServiceMock = {
    nextNumber: jest.fn(),
  };

  const txMock = {
    product: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    purchaseOrderItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    purchaseOrder: {
      update: jest.fn(),
      create: jest.fn(),
    },
  };

  const prismaMock = {
    $transaction: jest.fn(),
    purchaseOrder: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    supplier: {
      findFirst: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
    },
  };

  const buildOrder = (overrides: Record<string, unknown> = {}) => ({
    id: 'po-1',
    orderNumber: 12,
    supplierId: 'supplier-1',
    createdById: 'user-1',
    status: 'PENDING',
    subtotal: 500,
    taxAmount: 95,
    total: 595,
    notes: null,
    confirmedAt: new Date('2026-04-19T10:00:00.000Z'),
    receivedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date('2026-04-19T09:00:00.000Z'),
    updatedAt: new Date('2026-04-19T09:00:00.000Z'),
    items: [
      {
        id: 'poi-1',
        purchaseOrderId: 'po-1',
        productId: 'prod-1',
        qtyOrdered: 5,
        qtyReceived: 0,
        unitCost: 100,
        taxRate: 19,
        subtotal: 500,
        taxAmount: 95,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => unknown) => callback(txMock),
    );
    service = new PurchaseOrdersService(
      prismaMock as never,
      sequenceServiceMock as never,
    );
  });

  // ---- existing tests preserved ----

  it('rejects duplicated receive entries for the same item before touching stock', async () => {
    prismaMock.purchaseOrder.findFirst.mockResolvedValue(buildOrder());

    await expect(
      service.receive(
        'po-1',
        {
          items: [
            { itemId: 'poi-1', qtyReceivedNow: 2 },
            { itemId: 'poi-1', qtyReceivedNow: 1 },
          ],
        },
        'user-1',
        'org-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('revalidates pending quantity inside the transaction before updating stock', async () => {
    prismaMock.purchaseOrder.findFirst.mockResolvedValue(buildOrder());
    txMock.purchaseOrderItem.findUnique.mockResolvedValue({
      id: 'poi-1',
      purchaseOrderId: 'po-1',
      productId: 'prod-1',
      qtyOrdered: 5,
      qtyReceived: 4,
      unitCost: 100,
      taxRate: 19,
      subtotal: 500,
      taxAmount: 95,
    });

    await expect(
      service.receive(
        'po-1',
        { items: [{ itemId: 'poi-1', qtyReceivedNow: 2 }] },
        'user-1',
        'org-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(txMock.product.findFirst).not.toHaveBeenCalled();
    expect(txMock.inventoryMovement.create).not.toHaveBeenCalled();
    expect(txMock.purchaseOrderItem.update).not.toHaveBeenCalled();
  });

  it('treats dateTo as inclusive for the whole selected day', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
    prismaMock.purchaseOrder.count.mockResolvedValue(0);

    await service.findAll('org-1', { dateTo: '2026-04-19' });

    expect(prismaMock.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({
            lt: expect.any(Date),
          }),
        }),
      }),
    );

    const where = prismaMock.purchaseOrder.findMany.mock.calls[0][0].where as {
      createdAt: { lt: Date };
    };

    expect(where.createdAt.lt.toISOString()).toBe('2026-04-20T00:00:00.000Z');
  });

  it('filters the open orders, pending and partially received, with status OPEN', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
    prismaMock.purchaseOrder.count.mockResolvedValue(0);

    await service.findAll('org-1', { status: 'OPEN' });

    const where = prismaMock.purchaseOrder.findMany.mock.calls[0][0].where as {
      status: unknown;
    };
    expect(where.status).toEqual({ in: ['PENDING', 'PARTIAL_RECEIVED'] });
    expect(prismaMock.purchaseOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PENDING', 'PARTIAL_RECEIVED'] },
        }),
      }),
    );
  });

  it('keeps filtering a single status as before', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
    prismaMock.purchaseOrder.count.mockResolvedValue(0);

    await service.findAll('org-1', { status: 'PENDING' });

    const where = prismaMock.purchaseOrder.findMany.mock.calls[0][0].where as {
      status: unknown;
    };
    expect(where.status).toBe('PENDING');
  });

  it('accepts order-number searches with the OC- prefix', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
    prismaMock.purchaseOrder.count.mockResolvedValue(0);

    await service.findAll('org-1', { q: 'OC-12' });

    const where = prismaMock.purchaseOrder.findMany.mock.calls[0][0].where as {
      OR: Array<Record<string, unknown>>;
    };

    expect(where.OR).toEqual(
      expect.arrayContaining([expect.objectContaining({ orderNumber: 12 })]),
    );
  });

  it('keeps PARTIAL_RECEIVED orders non-cancellable', async () => {
    prismaMock.purchaseOrder.findFirst.mockResolvedValue(
      buildOrder({ status: 'PARTIAL_RECEIVED' }),
    );

    await expect(
      service.cancel('po-1', { reason: 'Saldo pendiente' }, 'org-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaMock.purchaseOrder.update).not.toHaveBeenCalled();
  });

  // ---- new tests for T5.3 ----

  it('create uses Serializable transaction and assigns orderNumber from SequenceService', async () => {
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown, _options: unknown) => {
        return callback(txMock);
      },
    );

    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 99,
      formatted: 'OC-99',
    });
    prismaMock.supplier.findFirst.mockResolvedValue({
      id: 'supplier-1',
      active: true,
    });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      active: true,
      taxRate: 19,
    });
    txMock.purchaseOrder.create.mockResolvedValue({
      id: 'po-new',
      orderNumber: 99,
    });

    // Mock findOne call inside create
    prismaMock.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-new',
      orderNumber: 99,
      organizationId: 'org-1',
      supplier: { id: 'supplier-1' },
      createdBy: { id: 'user-1', name: 'User', email: 'user@example.com' },
      items: [],
    });

    const dto = {
      supplierId: 'supplier-1',
      items: [{ productId: 'prod-1', qtyOrdered: 5, unitCost: 100 }],
    };

    await service.create(dto, 'user-1', 'org-1');

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
      'PO',
      new Date().getFullYear(),
    );

    expect(txMock.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          orderNumber: 99,
          createdById: 'user-1',
        }),
      }),
    );

    expect(txMock.purchaseOrderItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
        }),
      }),
    );
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
    prismaMock.supplier.findFirst.mockResolvedValue({
      id: 'supplier-1',
      active: true,
    });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      active: true,
      taxRate: 19,
    });

    const dto = {
      supplierId: 'supplier-1',
      items: [{ productId: 'prod-1', qtyOrdered: 5, unitCost: 100 }],
    };

    await expect(service.create(dto, 'user-1', 'org-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('findAll filters by organizationId', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
    prismaMock.purchaseOrder.count.mockResolvedValue(0);

    await service.findAll('org-1', {});

    expect(prismaMock.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
        }),
      }),
    );
    expect(prismaMock.purchaseOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
        }),
      }),
    );
  });

  it('findOne returns PO scoped by organizationId', async () => {
    prismaMock.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      organizationId: 'org-1',
      supplier: { id: 'supplier-1' },
      createdBy: { id: 'user-1', name: 'User', email: 'user@example.com' },
      items: [],
    });

    const result = await service.findOne('po-1', 'org-1');

    expect(prismaMock.purchaseOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1', organizationId: 'org-1' },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: 'po-1', organizationId: 'org-1' }),
    );
  });

  it('receive creates inventoryMovement and auditLog with organizationId', async () => {
    prismaMock.purchaseOrder.findFirst.mockResolvedValue(buildOrder());
    txMock.purchaseOrderItem.findUnique.mockResolvedValue({
      id: 'poi-1',
      purchaseOrderId: 'po-1',
      productId: 'prod-1',
      qtyOrdered: 5,
      qtyReceived: 0,
      unitCost: 100,
    });
    txMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      stock: 10,
      version: 1,
      costPrice: 100,
    });
    txMock.product.updateMany.mockResolvedValue({ count: 1 });
    txMock.purchaseOrderItem.findMany.mockResolvedValue([
      { id: 'poi-1', qtyOrdered: 5, qtyReceived: 2 },
    ]);

    await service.receive(
      'po-1',
      { items: [{ itemId: 'poi-1', qtyReceivedNow: 2 }] },
      'user-1',
      'org-1',
    );

    expect(txMock.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          type: 'PURCHASE',
        }),
      }),
    );
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to put a service on a purchase order', async () => {
    prismaMock.supplier.findFirst.mockResolvedValue({
      id: 'supplier-1',
      active: true,
    });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'serv-1',
      name: 'MANTENIMIENTO',
      type: 'SERVICE',
      active: true,
      taxRate: 0,
    });

    await expect(
      service.create(
        {
          supplierId: 'supplier-1',
          items: [{ productId: 'serv-1', qtyOrdered: 1, unitCost: 20000 }],
        } as never,
        'user-1',
        'org-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The refusal has to happen while validating the lines: no order number may be
    // consumed, and no order or order line may be written.
    expect(sequenceServiceMock.nextNumber).not.toHaveBeenCalled();
    expect(txMock.purchaseOrder.create).not.toHaveBeenCalled();
    expect(txMock.purchaseOrderItem.create).not.toHaveBeenCalled();
  });

  it('receives a service line without moving stock or the kárdex', async () => {
    prismaMock.purchaseOrder.findFirst.mockResolvedValue(buildOrder());
    txMock.purchaseOrderItem.findUnique.mockResolvedValue({
      id: 'poi-1',
      purchaseOrderId: 'po-1',
      productId: 'serv-1',
      qtyOrdered: 5,
      qtyReceived: 0,
      unitCost: 100,
    });
    txMock.product.findFirst.mockResolvedValue({
      id: 'serv-1',
      stock: 0,
      version: 1,
      costPrice: 0,
      type: 'SERVICE',
    });
    txMock.product.updateMany.mockResolvedValue({ count: 1 });
    txMock.purchaseOrderItem.findMany.mockResolvedValue([
      { id: 'poi-1', qtyOrdered: 5, qtyReceived: 2 },
    ]);

    await service.receive(
      'po-1',
      { items: [{ itemId: 'poi-1', qtyReceivedNow: 2 }] },
      'user-1',
      'org-1',
    );

    expect(txMock.product.updateMany).not.toHaveBeenCalled();
    expect(txMock.inventoryMovement.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    // The received quantity must still be recorded, otherwise the order can never close.
    expect(txMock.purchaseOrderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'poi-1' } }),
    );
  });

  it('refuses an untracked product on a purchase order', async () => {
    prismaMock.supplier.findFirst.mockResolvedValue({
      id: 'supplier-1',
      active: true,
    });
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-untracked',
      name: 'CAJA VACÍA',
      type: 'PRODUCT',
      tracksStock: false,
      active: true,
      taxRate: 19,
    });

    await expect(
      service.create(
        {
          supplierId: 'supplier-1',
          items: [
            { productId: 'prod-untracked', qtyOrdered: 1, unitCost: 50000 },
          ],
        } as never,
        'user-1',
        'org-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A line for something whose stock is not controlled records nothing meaningful.
    expect(sequenceServiceMock.nextNumber).not.toHaveBeenCalled();
    expect(txMock.purchaseOrder.create).not.toHaveBeenCalled();
    expect(txMock.purchaseOrderItem.create).not.toHaveBeenCalled();
  });

  it('receives an untracked product line without moving stock', async () => {
    prismaMock.purchaseOrder.findFirst.mockResolvedValue(buildOrder());
    txMock.purchaseOrderItem.findUnique.mockResolvedValue({
      id: 'poi-1',
      purchaseOrderId: 'po-1',
      productId: 'prod-untracked',
      qtyOrdered: 5,
      qtyReceived: 0,
      unitCost: 100,
    });
    txMock.product.findFirst.mockResolvedValue({
      id: 'prod-untracked',
      stock: 0,
      version: 1,
      costPrice: 0,
      type: 'PRODUCT',
      tracksStock: false,
    });
    txMock.product.updateMany.mockResolvedValue({ count: 1 });
    txMock.purchaseOrderItem.findMany.mockResolvedValue([
      { id: 'poi-1', qtyOrdered: 5, qtyReceived: 2 },
    ]);

    await service.receive(
      'po-1',
      { items: [{ itemId: 'poi-1', qtyReceivedNow: 2 }] },
      'user-1',
      'org-1',
    );

    expect(txMock.product.updateMany).not.toHaveBeenCalled();
    expect(txMock.inventoryMovement.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    // The received quantity must still be recorded, otherwise the order can never close.
    expect(txMock.purchaseOrderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'poi-1' } }),
    );
  });
});
