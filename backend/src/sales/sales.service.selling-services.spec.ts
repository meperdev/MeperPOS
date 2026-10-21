import { ConflictException } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import { SalesService } from './sales.service';

/**
 * Selling a service must be indistinguishable from selling anything else from the
 * cashier's point of view, and completely invisible to the kárdex: no stock guard, no
 * decrement, no movement on the way in, and no restore on the way out.
 *
 * These specs are deliberately separate from `sales.service.spec.ts` so the
 * service-specific contract stays reviewable on its own.
 */
describe('SalesService — selling services', () => {
  let service: SalesService;

  const prismaMock = {
    $transaction: jest.fn(),
    sale: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
    },
    posLoanSaleIntent: { findFirst: jest.fn() },
  };

  const cacheMock = { clear: jest.fn() };
  const settingsServiceMock = { find: jest.fn() };
  const sequenceServiceMock = { nextNumber: jest.fn() };
  const receiptsServiceMock = { generateSaleReceiptPdf: jest.fn() };

  const productRow = (
    overrides: Partial<{
      id: string;
      name: string;
      type: ProductType;
      stock: number;
      reservedStock: number;
      version: number;
      salePrice: number;
    }> = {},
  ) => ({
    id: 'prod-1',
    name: 'Test Product',
    type: ProductType.PRODUCT,
    active: true,
    salePrice: 100,
    taxable: false,
    taxRate: 0,
    stock: 10,
    reservedStock: 0,
    version: 0,
    tracksStock: true,
    category: { taxable: false, defaultTaxRate: null },
    ...overrides,
  });

  const buildTx = () => ({
    sale: {
      create: jest.fn().mockResolvedValue({ id: 'sale-new', saleNumber: 42 }),
    },
    saleItem: { create: jest.fn() },
    product: {
      findFirst: jest.fn().mockResolvedValue(productRow()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    inventoryMovement: { create: jest.fn() },
    payment: { create: jest.fn() },
  });

  const wireTransaction = (txMock: ReturnType<typeof buildTx>) => {
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(txMock),
    );
    return txMock;
  };

  const wireCreate = () => {
    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 42,
      formatted: '42',
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
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.posLoanSaleIntent.findFirst.mockResolvedValue(null);
    service = new SalesService(
      prismaMock as never,
      cacheMock as never,
      settingsServiceMock as never,
      sequenceServiceMock as never,
      receiptsServiceMock as never,
    );
    wireCreate();
  });

  const serviceRow = (overrides = {}) =>
    productRow({
      id: 'serv-1',
      name: 'MANTENIMIENTO',
      type: ProductType.SERVICE,
      salePrice: 20000,
      ...overrides,
    });

  describe('create', () => {
    const checkout = (quantity = 2) =>
      service.create(
        {
          items: [{ productId: 'prod-1', quantity }],
          payments: [{ method: 'CASH', amount: 1000 }],
        },
        'user-1',
        'org-1',
      );

    it.each([9, 10])(
      'rejects overselling with %i reserved units',
      async (reservedStock) => {
        const tx = wireTransaction(buildTx());
        prismaMock.product.findFirst.mockResolvedValue(productRow());
        tx.product.findFirst.mockResolvedValue(productRow({ reservedStock }));
        await expect(checkout()).rejects.toThrow('Insufficient stock');
        expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
        expect(tx.payment.create).not.toHaveBeenCalled();
      },
    );

    it.each([0, 8])(
      'pins the tenant, version and counter at the available boundary (%i reserved)',
      async (reservedStock) => {
        const tx = wireTransaction(buildTx());
        prismaMock.product.findFirst.mockResolvedValue(productRow());
        tx.product.findFirst.mockResolvedValue(
          productRow({ reservedStock, version: 7 }),
        );
        await checkout();
        expect(tx.product.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'prod-1',
            organizationId: 'org-1',
            active: true,
            type: ProductType.PRODUCT,
            tracksStock: true,
            version: 7,
            reservedStock,
            stock: { gte: reservedStock + 2 },
          },
          data: { stock: { decrement: 2 }, version: { increment: 1 } },
        });
      },
    );

    it.each(['version', 'reservedStock'] as const)(
      'rejects a concurrent %s mismatch using the actual CAS',
      async (field) => {
        const tx = wireTransaction(buildTx());
        prismaMock.product.findFirst.mockResolvedValue(productRow());
        tx.product.findFirst.mockResolvedValue(
          productRow({ reservedStock: 3, version: 7 }),
        );
        const competing = { version: 7, reservedStock: 3, [field]: 8 };
        tx.product.updateMany.mockImplementation(
          ({ where }: { where: { version: number; reservedStock: number } }) =>
            Promise.resolve({
              count:
                where.version === competing.version &&
                where.reservedStock === competing.reservedStock
                  ? 1
                  : 0,
            }),
        );
        await expect(checkout()).rejects.toThrow('Insufficient stock');
        expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      },
    );

    it('re-reads successive versions for repeated product lines', async () => {
      const tx = wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(productRow());
      tx.product.findFirst
        .mockResolvedValueOnce(productRow({ version: 7 }))
        .mockResolvedValueOnce({ stock: 9 })
        .mockResolvedValueOnce(productRow({ stock: 9, version: 8 }))
        .mockResolvedValueOnce({ stock: 8 });
      await service.create(
        {
          items: [
            { productId: 'prod-1', quantity: 1 },
            { productId: 'prod-1', quantity: 1 },
          ],
          payments: [{ method: 'CASH', amount: 200 }],
        },
        'user-1',
        'org-1',
      );
      const writes = tx.product.updateMany.mock.calls as Array<
        [{ where: { version: number } }]
      >;
      expect(writes.map(([args]) => args.where.version)).toEqual([7, 8]);
    });

    it('fails closed when the live reservation counter is missing', async () => {
      const tx = wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(productRow());
      tx.product.findFirst.mockResolvedValue({
        stock: 10,
        version: 7,
      } as never);
      await expect(checkout()).rejects.toThrow('Insufficient stock');
      expect(tx.product.updateMany).not.toHaveBeenCalled();
    });

    it('aborts on a lost stock CAS before movement or payment', async () => {
      const tx = wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(productRow());
      tx.product.updateMany.mockResolvedValue({ count: 0 });
      await expect(checkout()).rejects.toThrow('Insufficient stock');
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('sells a zero-stock service and writes no inventory movement', async () => {
      const txMock = wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(serviceRow({ stock: 0 }));

      await service.create(
        {
          items: [{ productId: 'serv-1', quantity: 1, discountAmount: 0 }],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 20000 }],
        },
        'user-1',
        'org-1',
      );

      expect(txMock.saleItem.create).toHaveBeenCalledTimes(1);
      expect(txMock.product.updateMany).not.toHaveBeenCalled();
      expect(txMock.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('accepts an arbitrary service quantity without a stock ceiling', async () => {
      const txMock = wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(serviceRow({ stock: 0 }));

      await service.create(
        {
          items: [{ productId: 'serv-1', quantity: 5, discountAmount: 0 }],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 100000 }],
        },
        'user-1',
        'org-1',
      );

      expect(txMock.saleItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: 5 }),
        }),
      );
      expect(txMock.product.updateMany).not.toHaveBeenCalled();
      expect(txMock.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('still guards, decrements and records the movement for a product in the same sale', async () => {
      const txMock = wireTransaction(buildTx());
      prismaMock.product.findFirst
        .mockResolvedValueOnce(serviceRow({ stock: 0 }))
        .mockResolvedValueOnce(productRow({ id: 'prod-1', stock: 10 }));

      await service.create(
        {
          items: [
            { productId: 'serv-1', quantity: 1, discountAmount: 0 },
            { productId: 'prod-1', quantity: 1, discountAmount: 0 },
          ],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 20100 }],
        },
        'user-1',
        'org-1',
      );

      expect(txMock.product.updateMany).toHaveBeenCalledTimes(1);
      expect(txMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'prod-1' }),
        }),
      );
      expect(txMock.inventoryMovement.create).toHaveBeenCalledTimes(1);
      expect(txMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productId: 'prod-1', type: 'SALE' }),
        }),
      );
    });

    it('sells an untracked product with no stock and writes no inventory movement', async () => {
      const txMock = wireTransaction(buildTx());
      // An untracked product is merchandise nobody counts: it is billed like a
      // service, so its stock is never guarded or moved.
      prismaMock.product.findFirst.mockResolvedValue({
        ...productRow({ id: 'prod-1', stock: 0 }),
        tracksStock: false,
      });

      await service.create(
        {
          items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
          discountAmount: 0,
          payments: [{ method: 'CASH' as const, amount: 100 }],
        },
        'user-1',
        'org-1',
      );

      expect(txMock.saleItem.create).toHaveBeenCalledTimes(1);
      expect(txMock.product.updateMany).not.toHaveBeenCalled();
      expect(txMock.inventoryMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('update — cancelling a sale', () => {
    const saleWithItem = (productId: string, quantity: number) => ({
      id: 'sale-1',
      status: 'COMPLETED',
      userId: 'user-1',
      organizationId: 'org-1',
      saleNumber: 10,
      items: [{ id: 'si-1', productId, quantity }],
    });

    it.each([false, true])(
      'stops a losing cancellation before any effects (prior winner: %s)',
      async (priorWinner) => {
        const tx = {
          sale: {
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          product: {
            findFirst: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
          },
          inventoryMovement: { create: jest.fn() },
        };
        if (priorWinner) tx.sale.updateMany.mockResolvedValueOnce({ count: 1 });
        tx.product.findFirst.mockResolvedValue(productRow({ stock: 5 }));
        tx.product.updateMany.mockResolvedValue({ count: 1 });
        prismaMock.sale.findFirst.mockResolvedValue(saleWithItem('prod-1', 2));
        prismaMock.$transaction.mockImplementation(
          (callback: (tx: unknown) => unknown) => callback(tx),
        );
        if (priorWinner)
          await service.update(
            'sale-1',
            { status: 'CANCELLED' },
            'user-1',
            'org-1',
          );
        const reads = tx.product.findFirst.mock.calls.length;
        const movements = tx.inventoryMovement.create.mock.calls.length;
        const restocks = tx.product.updateMany.mock.calls.length;
        await expect(
          service.update('sale-1', { status: 'CANCELLED' }, 'user-1', 'org-1'),
        ).rejects.toThrow('Only completed sales can be updated');
        expect(tx.product.findFirst).toHaveBeenCalledTimes(reads);
        expect(tx.product.updateMany).toHaveBeenCalledTimes(restocks);
        expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(movements);
        expect(tx.sale.updateMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            where: {
              id: 'sale-1',
              organizationId: 'org-1',
              status: 'COMPLETED',
            },
          }),
        );
      },
    );

    it('propagates restock CAS failure from the transaction without a movement', async () => {
      const tx = {
        sale: {
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        product: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              productRow({ stock: 5, reservedStock: 3, version: 7 }),
            ),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        inventoryMovement: { create: jest.fn() },
      };
      prismaMock.sale.findFirst.mockResolvedValue(saleWithItem('prod-1', 2));
      prismaMock.$transaction.mockImplementation(
        (callback: (tx: unknown) => unknown) => callback(tx),
      );
      await expect(
        service.update('sale-1', { status: 'CANCELLED' }, 'user-1', 'org-1'),
      ).rejects.toThrow('Stock changed');
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      expect(prismaMock.sale.findFirst).toHaveBeenCalledTimes(1);
    });

    it('refuses restocking with a missing live reservation counter', async () => {
      const tx = {
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        product: {
          findFirst: jest.fn().mockResolvedValue({ stock: 5, version: 7 }),
          updateMany: jest.fn(),
        },
        inventoryMovement: { create: jest.fn() },
      };
      prismaMock.sale.findFirst.mockResolvedValue(saleWithItem('prod-1', 2));
      prismaMock.$transaction.mockImplementation(
        (callback: (tx: unknown) => unknown) => callback(tx),
      );
      await expect(
        service.update('sale-1', { status: 'CANCELLED' }, 'user-1', 'org-1'),
      ).rejects.toThrow('Stock changed');
      expect(tx.product.updateMany).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    const cancelledSale = {
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
    };

    it.each(['CANCELLED', 'RETURNED_PARTIAL'] as const)(
      'rejects %s for a linked financed sale before any state or inventory writes',
      async (status) => {
        const intent = {
          id: 'intent',
          loanId: 'loan',
          organizationId: 'org-1',
          finalSaleId: 'sale-1',
        };
        prismaMock.posLoanSaleIntent.findFirst.mockResolvedValue(intent);
        prismaMock.sale.findFirst.mockResolvedValue({
          ...saleWithItem('prod-1', 2),
          posLoanSaleIntent: intent,
        });
        prismaMock.sale.update.mockResolvedValue({ status });
        const tx = {
          sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          posLoanSaleIntent: prismaMock.posLoanSaleIntent,
          product: {
            findFirst: jest.fn().mockResolvedValue(productRow({ stock: 5 })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          inventoryMovement: { create: jest.fn() },
        };
        prismaMock.$transaction.mockImplementation(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        );

        await expect(
          service.update('sale-1', { status }, 'user-1', 'org-1'),
        ).rejects.toThrow(ConflictException);
        expect(prismaMock.sale.update).not.toHaveBeenCalled();
        expect(tx.sale.updateMany).not.toHaveBeenCalled();
        expect(tx.product.findFirst).not.toHaveBeenCalled();
        expect(tx.product.updateMany).not.toHaveBeenCalled();
        expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      },
    );

    it('does not restock RETURNED_PARTIAL sales', async () => {
      prismaMock.sale.findFirst.mockResolvedValue(saleWithItem('prod-1', 2));
      prismaMock.sale.update.mockResolvedValue({ status: 'RETURNED_PARTIAL' });
      await service.update(
        'sale-1',
        { status: 'RETURNED_PARTIAL' },
        'user-1',
        'org-1',
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('cancels an untracked product without stock effects', async () => {
      const tx = {
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        product: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ ...productRow(), tracksStock: false }),
          updateMany: jest.fn(),
        },
        inventoryMovement: { create: jest.fn() },
      };
      prismaMock.sale.findFirst.mockResolvedValue(saleWithItem('prod-1', 2));
      prismaMock.$transaction.mockImplementation(
        (callback: (tx: unknown) => unknown) => callback(tx),
      );
      await service.update(
        'sale-1',
        { status: 'CANCELLED' },
        'user-1',
        'org-1',
      );
      expect(tx.product.updateMany).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('cancels a service sale without restoring stock or writing a RETURN', async () => {
      const txMock = {
        product: {
          findFirst: jest.fn().mockResolvedValue(serviceRow({ stock: 0 })),
          updateMany: jest.fn(),
        },
        inventoryMovement: { create: jest.fn() },
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      prismaMock.sale.findFirst
        .mockResolvedValueOnce(saleWithItem('serv-1', 2))
        .mockResolvedValueOnce(cancelledSale);
      prismaMock.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) => callback(txMock),
      );

      await service.update(
        'sale-1',
        { status: 'CANCELLED', cancelReason: 'Cliente arrepentido' },
        'user-1',
        'org-1',
      );

      expect(txMock.product.updateMany).not.toHaveBeenCalled();
      expect(txMock.inventoryMovement.create).not.toHaveBeenCalled();
      expect(txMock.sale.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });

    it('still restores stock and writes a RETURN for a product line', async () => {
      const txMock = {
        product: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              productRow({ stock: 5, reservedStock: 3, version: 7 }),
            ),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryMovement: { create: jest.fn() },
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      prismaMock.sale.findFirst
        .mockResolvedValueOnce(saleWithItem('prod-1', 2))
        .mockResolvedValueOnce(cancelledSale);
      prismaMock.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) => callback(txMock),
      );

      await service.update(
        'sale-1',
        { status: 'CANCELLED', cancelReason: 'Cliente arrepentido' },
        'user-1',
        'org-1',
      );

      expect(txMock.product.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'prod-1',
          organizationId: 'org-1',
          version: 7,
          reservedStock: 3,
        },
        data: { stock: { increment: 2 }, version: { increment: 1 } },
      });
      expect(txMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'prod-1',
            type: 'RETURN',
            quantity: 2,
            previousStock: 5,
            newStock: 7,
          }),
        }),
      );
    });
  });
});
