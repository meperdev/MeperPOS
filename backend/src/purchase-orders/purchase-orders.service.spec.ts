import {
  BadRequestException,
  NotFoundException,
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
    $queryRaw: jest.fn(),
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
      updateMany: jest.fn(),
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
    txMock.$queryRaw.mockResolvedValue([{ status: 'PENDING' }]);
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

    expect(prismaMock.purchaseOrder.updateMany).not.toHaveBeenCalled();
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

  describe('duplicate (repeat order)', () => {
    const product = (overrides: Record<string, unknown> = {}) => ({
      id: 'prod-1',
      name: 'Café',
      active: true,
      type: 'PRODUCT',
      tracksStock: true,
      costPrice: '120',
      taxRate: '19',
      ...overrides,
    });

    const source = (items: Array<Record<string, unknown>>) =>
      buildOrder({ status: 'RECEIVED', notes: 'Entregar temprano', items });

    let createSpy: jest.SpyInstance;

    beforeEach(() => {
      createSpy = jest
        .spyOn(service, 'create')
        .mockResolvedValue({ id: 'po-new' } as never);
    });

    it('creates a draft through create() with the same supplier, products, quantities and current cost', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        source([
          {
            id: 'poi-1',
            productId: 'prod-1',
            qtyOrdered: 5,
            unitCost: 100,
            product: product(),
          },
          {
            id: 'poi-2',
            productId: 'prod-2',
            qtyOrdered: 2,
            unitCost: 80,
            product: product({
              id: 'prod-2',
              name: 'Azúcar',
              costPrice: '90.5',
            }),
          },
        ]),
      );

      const result = await service.duplicate('po-1', {}, 'user-1', 'org-1');

      expect(prismaMock.purchaseOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-1', organizationId: 'org-1' },
        }),
      );
      // No taxRate: create() takes the product's rate, as for any new order.
      expect(createSpy).toHaveBeenCalledWith(
        {
          supplierId: 'supplier-1',
          items: [
            { productId: 'prod-1', qtyOrdered: 5, unitCost: 120 },
            { productId: 'prod-2', qtyOrdered: 2, unitCost: 90.5 },
          ],
        },
        'user-1',
        'org-1',
      );
      expect(result).toEqual({ order: { id: 'po-new' }, skippedItems: [] });
    });

    it('creates the draft for another supplier when one is chosen', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        source([
          {
            id: 'poi-1',
            productId: 'prod-1',
            qtyOrdered: 5,
            product: product(),
          },
        ]),
      );

      await service.duplicate(
        'po-1',
        { supplierId: 'supplier-2' },
        'user-1',
        'org-1',
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ supplierId: 'supplier-2' }),
        'user-1',
        'org-1',
      );
    });

    it('leaves out inactive products and services and reports them', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        source([
          {
            id: 'poi-1',
            productId: 'prod-1',
            qtyOrdered: 5,
            product: product(),
          },
          {
            id: 'poi-2',
            productId: 'prod-2',
            qtyOrdered: 1,
            product: product({ id: 'prod-2', name: 'Viejo', active: false }),
          },
          {
            id: 'poi-3',
            productId: 'prod-3',
            qtyOrdered: 1,
            product: product({
              id: 'prod-3',
              name: 'Instalación',
              type: 'SERVICE',
              tracksStock: false,
            }),
          },
        ]),
      );

      const result = await service.duplicate('po-1', {}, 'user-1', 'org-1');

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [{ productId: 'prod-1', qtyOrdered: 5, unitCost: 120 }],
        }),
        'user-1',
        'org-1',
      );
      expect(result.skippedItems).toEqual([
        { productId: 'prod-2', name: 'Viejo', reason: 'INACTIVE' },
        { productId: 'prod-3', name: 'Instalación', reason: 'NOT_STOCKED' },
      ]);
    });

    it('refuses when no product can be ordered again, without creating anything', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        source([
          {
            id: 'poi-1',
            productId: 'prod-1',
            qtyOrdered: 5,
            product: product({ active: false }),
          },
        ]),
      );

      await expect(
        service.duplicate('po-1', {}, 'user-1', 'org-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('answers 404 for an order of another organization', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.duplicate('po-1', {}, 'user-1', 'org-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('expected delivery date and overdue orders', () => {
    // 2026-11-18 03:00 UTC is still 2026-11-17 in Bogotá (UTC-5).
    const NOW = new Date('2026-11-18T03:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const draftWithItem = () =>
      buildOrder({
        status: 'DRAFT',
        confirmedAt: null,
        supplier: { id: 'supplier-1', active: true },
      });

    it('confirm stores the expected delivery date as a calendar day', async () => {
      prismaMock.purchaseOrder.findFirst
        .mockResolvedValueOnce(draftWithItem())
        .mockResolvedValueOnce(buildOrder());

      await service.confirm('po-1', 'org-1', {
        expectedDeliveryDate: '2026-11-25',
      });

      expect(prismaMock.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: {
          status: 'PENDING',
          confirmedAt: expect.any(Date),
          expectedDeliveryDate: new Date('2026-11-25T00:00:00.000Z'),
        },
      });
    });

    it('confirm without a date keeps confirming as before', async () => {
      prismaMock.purchaseOrder.findFirst
        .mockResolvedValueOnce(draftWithItem())
        .mockResolvedValueOnce(buildOrder());

      await service.confirm('po-1', 'org-1');

      expect(prismaMock.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: { status: 'PENDING', confirmedAt: expect.any(Date) },
      });
    });

    it.each([
      ['PENDING', '2026-11-16', true],
      ['PARTIAL_RECEIVED', '2026-11-16', true],
      ['PENDING', '2026-11-17', false],
      ['PENDING', null, false],
      ['RECEIVED', '2026-11-16', false],
      ['CANCELLED', '2026-11-16', false],
      ['DRAFT', '2026-11-16', false],
    ])(
      'findOne marks a %s order expected on %s as overdue=%s',
      async (status, expected, overdue) => {
        prismaMock.purchaseOrder.findFirst.mockResolvedValue(
          buildOrder({
            status,
            expectedDeliveryDate: expected
              ? new Date(`${expected}T00:00:00.000Z`)
              : null,
          }),
        );

        const result = await service.findOne('po-1', 'org-1');

        expect(result.overdue).toBe(overdue);
      },
    );

    it('findAll marks every listed order', async () => {
      prismaMock.purchaseOrder.findMany.mockResolvedValue([
        buildOrder({
          id: 'late',
          expectedDeliveryDate: new Date('2026-11-10T00:00:00.000Z'),
        }),
        buildOrder({ id: 'on-time', expectedDeliveryDate: null }),
      ]);
      prismaMock.purchaseOrder.count.mockResolvedValue(2);

      const result = await service.findAll('org-1', {});

      expect(result.data.map((order) => [order.id, order.overdue])).toEqual([
        ['late', true],
        ['on-time', false],
      ]);
    });

    it('filters the overdue orders with status OVERDUE', async () => {
      prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
      prismaMock.purchaseOrder.count.mockResolvedValue(0);

      await service.findAll('org-1', { status: 'OVERDUE' });

      const where = prismaMock.purchaseOrder.findMany.mock.calls[0][0]
        .where as Record<string, unknown>;
      expect(where.status).toEqual({ in: ['PENDING', 'PARTIAL_RECEIVED'] });
      expect(where.expectedDeliveryDate).toEqual({
        lt: new Date('2026-11-17T00:00:00.000Z'),
      });
      expect(prismaMock.purchaseOrder.count).toHaveBeenCalledWith({
        where,
      });
    });
  });
});
