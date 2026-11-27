import { ConflictException } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import { SalesService } from './sales.service';
import {
  applySiteStockDelta,
  resolveDefaultSiteWithin,
} from '../inventory/site-stock';

// T3b: the site ledger itself is proven against real PostgreSQL in
// `inventory/site-stock.postgres.spec.ts` and
// `sales-site-stock.postgres.spec.ts`. These unit specs assert the delta
// `SalesService` requests and how it reacts to a refusal.
jest.mock('../inventory/site-stock', () => ({
  applySiteStockDelta: jest.fn(() =>
    Promise.resolve({ applied: true, created: false }),
  ),
  resolveDefaultSiteWithin: jest.fn(() => Promise.resolve('site-default')),
}));

const siteDelta = jest.mocked(applySiteStockDelta);
const defaultSite = jest.mocked(resolveDefaultSiteWithin);

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
      create: jest.fn().mockResolvedValue({
        id: 'sale-new',
        saleNumber: 42,
        createdAt: new Date('2026-11-04T15:20:31.000Z'),
      }),
    },
    saleItem: { create: jest.fn() },
    product: {
      findFirst: jest.fn().mockResolvedValue(productRow()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    inventoryMovement: { create: jest.fn() },
    payment: { create: jest.fn() },
    // Spec S9: this organization has not activated electronic invoicing, so the
    // ordinary sale path reads the flag and writes no fiscal record.
    organization: {
      findFirst: jest.fn().mockResolvedValue({ taxId: null, settings: {} }),
    },
    fiscalDocument: { create: jest.fn() },
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
    // `resetAllMocks` also clears the ledger stubs of the module mock above.
    siteDelta.mockResolvedValue({ applied: true, created: false });
    defaultSite.mockResolvedValue('site-default');
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

    it('takes the line quantity out of the site that fulfils the sale', async () => {
      const tx = wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(productRow());
      await checkout();

      expect(defaultSite).toHaveBeenCalledWith(tx, 'org-1');
      expect(siteDelta).toHaveBeenCalledTimes(1);
      expect(siteDelta).toHaveBeenCalledWith(tx, {
        organizationId: 'org-1',
        productId: 'prod-1',
        locationId: 'site-default',
        stockDelta: -2,
        reservedDelta: 0,
      });
      // The product keeps its optimistic-concurrency version advancing, and
      // the bump re-pins an active, stock-tracked product as the old CAS did.
      expect(tx.product.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'prod-1',
          organizationId: 'org-1',
          active: true,
          type: 'PRODUCT',
          tracksStock: true,
        },
        data: { version: { increment: 1 } },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ locationId: 'site-default' }),
        }),
      );
    });

    it('refuses the sale when the site cannot cover the line', async () => {
      const tx = wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(productRow());
      siteDelta.mockResolvedValue({
        applied: false,
        reason: 'insufficient-stock',
      });
      await expect(checkout()).rejects.toThrow(
        'Insufficient stock for product prod-1',
      );
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.product.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a product deactivated or untracked after pricing', async () => {
      const tx = wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(productRow());
      tx.product.updateMany.mockResolvedValue({ count: 0 });
      await expect(checkout()).rejects.toThrow(
        'Insufficient stock for product prod-1',
      );
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it("asks the sale's site for one delta per repeated line of the same product", async () => {
      wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(productRow());
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
      const deltas = siteDelta.mock.calls as unknown as Array<
        [unknown, { stockDelta: number; locationId: string }]
      >;
      expect(deltas.map(([, delta]) => delta.stockDelta)).toEqual([-1, -1]);
      expect(deltas.map(([, delta]) => delta.locationId)).toEqual([
        'site-default',
        'site-default',
      ]);
    });

    it('fails closed when the organization has no site to take stock from', async () => {
      const tx = wireTransaction(buildTx());
      prismaMock.product.findFirst.mockResolvedValue(productRow());
      defaultSite.mockRejectedValue(
        new Error('Organization org-1 has no default location'),
      );
      await expect(checkout()).rejects.toThrow('has no default location');
      expect(siteDelta).not.toHaveBeenCalled();
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
      expect(siteDelta).not.toHaveBeenCalled();
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
      expect(siteDelta).not.toHaveBeenCalled();
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

      expect(siteDelta).toHaveBeenCalledTimes(1);
      expect(siteDelta).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({
          productId: 'prod-1',
          locationId: 'site-default',
          stockDelta: -1,
        }),
      );
      expect(txMock.inventoryMovement.create).toHaveBeenCalledTimes(1);
      expect(txMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'prod-1',
            type: 'SALE',
            locationId: 'site-default',
          }),
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
      expect(siteDelta).not.toHaveBeenCalled();
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

    // Spec S8: cancellation voids the pending fiscal document in the same
    // transaction; it can never leave a pending document behind a cancelled sale.
    it('voids the pending fiscal document in the same transaction', async () => {
      const tx = {
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        fiscalDocument: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'fiscal-1', status: 'PENDING' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        product: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ ...productRow(), tracksStock: false }),
          updateMany: jest.fn(),
        },
        inventoryMovement: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
        },
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

      expect(tx.fiscalDocument.findFirst).toHaveBeenCalledWith({
        where: { saleId: 'sale-1', organizationId: 'org-1' },
        select: { id: true, status: true },
      });
      expect(tx.fiscalDocument.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'fiscal-1',
          organizationId: 'org-1',
          status: 'PENDING',
        },
        data: { status: 'VOIDED', resolvedAt: expect.any(Date) },
      });
    });

    it('refuses to cancel a sale whose fiscal document is already accepted', async () => {
      const tx = {
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        fiscalDocument: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'fiscal-1', status: 'ACCEPTED' }),
          updateMany: jest.fn(),
        },
        product: {
          findFirst: jest.fn(),
          updateMany: jest.fn(),
        },
        inventoryMovement: { findMany: jest.fn(), create: jest.fn() },
      };
      prismaMock.sale.findFirst.mockResolvedValue(saleWithItem('prod-1', 2));
      prismaMock.$transaction.mockImplementation(
        (callback: (tx: unknown) => unknown) => callback(tx),
      );

      await expect(
        service.update('sale-1', { status: 'CANCELLED' }, 'user-1', 'org-1'),
      ).rejects.toThrow(ConflictException);

      expect(tx.fiscalDocument.updateMany).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.findMany).not.toHaveBeenCalled();
      expect(siteDelta).not.toHaveBeenCalled();
      expect(tx.product.updateMany).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      'stops a losing cancellation before any effects (prior winner: %s)',
      async (priorWinner) => {
        const tx = {
          sale: {
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          fiscalDocument: {
            findFirst: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn(),
          },
          product: {
            findFirst: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
          },
          inventoryMovement: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ productId: 'prod-1', quantity: -2 }]),
            create: jest.fn(),
          },
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
        const siteReads = defaultSite.mock.calls.length;
        const movements = tx.inventoryMovement.create.mock.calls.length;
        const movementReads = tx.inventoryMovement.findMany.mock.calls.length;
        const restocks = siteDelta.mock.calls.length;
        const versions = tx.product.updateMany.mock.calls.length;
        await expect(
          service.update('sale-1', { status: 'CANCELLED' }, 'user-1', 'org-1'),
        ).rejects.toThrow('Only completed sales can be updated');
        expect(tx.inventoryMovement.findMany).toHaveBeenCalledTimes(
          movementReads,
        );
        expect(defaultSite).toHaveBeenCalledTimes(siteReads);
        expect(siteDelta).toHaveBeenCalledTimes(restocks);
        expect(tx.product.updateMany).toHaveBeenCalledTimes(versions);
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

    it('propagates a refused site restore from the transaction without a movement', async () => {
      const tx = {
        sale: {
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
        },
        product: {
          findFirst: jest.fn().mockResolvedValue(productRow({ stock: 5 })),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryMovement: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ productId: 'prod-1', quantity: -2 }]),
          create: jest.fn(),
        },
      };
      siteDelta.mockResolvedValue({
        applied: false,
        reason: 'insufficient-stock',
      });
      prismaMock.sale.findFirst.mockResolvedValue(saleWithItem('prod-1', 2));
      prismaMock.$transaction.mockImplementation(
        (callback: (tx: unknown) => unknown) => callback(tx),
      );
      await expect(
        service.update('sale-1', { status: 'CANCELLED' }, 'user-1', 'org-1'),
      ).rejects.toThrow('Stock changed for product prod-1');
      expect(tx.product.updateMany).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      expect(prismaMock.sale.findFirst).toHaveBeenCalledTimes(1);
    });

    it('refuses to restore stock when the organization has no site to restore it to', async () => {
      const tx = {
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
        },
        product: {
          findFirst: jest.fn().mockResolvedValue(productRow({ stock: 5 })),
          updateMany: jest.fn(),
        },
        inventoryMovement: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ productId: 'prod-1', quantity: -2 }]),
          create: jest.fn(),
        },
      };
      defaultSite.mockRejectedValue(
        new Error('Organization org-1 has no default location'),
      );
      prismaMock.sale.findFirst.mockResolvedValue(saleWithItem('prod-1', 2));
      prismaMock.$transaction.mockImplementation(
        (callback: (tx: unknown) => unknown) => callback(tx),
      );
      await expect(
        service.update('sale-1', { status: 'CANCELLED' }, 'user-1', 'org-1'),
      ).rejects.toThrow('has no default location');
      expect(siteDelta).not.toHaveBeenCalled();
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

    it.each(['CANCELLED'] as const)(
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
          fiscalDocument: {
            findFirst: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn(),
          },
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
        expect(siteDelta).not.toHaveBeenCalled();
        expect(tx.product.updateMany).not.toHaveBeenCalled();
        expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      },
    );

    // SEC-013: `RETURNED_PARTIAL` is no longer part of the update contract (see
    // `sales.dto.spec.ts` and `sales.service.hardening.spec.ts`), so the service
    // has no bare status flip left to exercise here.

    it('does not invent stock when a product sold untracked has tracking enabled later', async () => {
      // The reported bug: the sale took no stock because the product did not
      // track it. Enabling tracking afterwards must not conjure a restore, so
      // today's flag never decides: only the SALE movements do.
      const tx = {
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
        },
        product: {
          findFirst: jest.fn().mockResolvedValue(productRow({ stock: 5 })),
          updateMany: jest.fn(),
        },
        inventoryMovement: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
        },
      };
      prismaMock.sale.findFirst
        .mockResolvedValueOnce(saleWithItem('prod-1', 2))
        .mockResolvedValueOnce(cancelledSale);
      prismaMock.$transaction.mockImplementation(
        (callback: (tx: unknown) => unknown) => callback(tx),
      );
      await service.update(
        'sale-1',
        { status: 'CANCELLED' },
        'user-1',
        'org-1',
      );
      expect(tx.inventoryMovement.findMany).toHaveBeenCalledWith({
        where: {
          saleId: 'sale-1',
          organizationId: 'org-1',
          type: 'SALE',
        },
        select: { productId: true, quantity: true },
      });
      expect(siteDelta).not.toHaveBeenCalled();
      expect(tx.product.updateMany).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('cancels a service sale without restoring stock or writing a RETURN', async () => {
      const txMock = {
        product: {
          findFirst: jest.fn().mockResolvedValue(serviceRow({ stock: 0 })),
          updateMany: jest.fn(),
        },
        inventoryMovement: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
        },
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
        },
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

    it('restores stock and writes a RETURN at the sale site for a product line', async () => {
      const txMock = {
        product: {
          findFirst: jest.fn().mockResolvedValue(productRow({ stock: 5 })),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryMovement: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ productId: 'prod-1', quantity: -2 }]),
          create: jest.fn(),
        },
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
        },
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

      expect(txMock.inventoryMovement.findMany).toHaveBeenCalledWith({
        where: {
          saleId: 'sale-1',
          organizationId: 'org-1',
          type: 'SALE',
        },
        select: { productId: true, quantity: true },
      });
      // A sale without a stored origin took its units from the default site.
      expect(defaultSite).toHaveBeenCalledWith(txMock, 'org-1');
      expect(siteDelta).toHaveBeenCalledTimes(1);
      expect(siteDelta).toHaveBeenCalledWith(txMock, {
        organizationId: 'org-1',
        productId: 'prod-1',
        locationId: 'site-default',
        stockDelta: 2,
        reservedDelta: 0,
      });
      expect(txMock.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', organizationId: 'org-1' },
        data: { version: { increment: 1 } },
      });
      expect(txMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'prod-1',
            type: 'RETURN',
            quantity: 2,
            previousStock: 5,
            newStock: 7,
            locationId: 'site-default',
          }),
        }),
      );
    });

    it('restores stock from the SALE movements even when the product no longer tracks it', async () => {
      // The inverse of the bug: sold as merchandise, later turned into a
      // service. What left stock is the movement, not today's flag.
      const txMock = {
        product: {
          findFirst: jest.fn().mockResolvedValue(serviceRow({ stock: 5 })),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryMovement: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ productId: 'prod-1', quantity: -2 }]),
          create: jest.fn(),
        },
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
        },
      };
      prismaMock.sale.findFirst
        .mockResolvedValueOnce(saleWithItem('prod-1', 2))
        .mockResolvedValueOnce(cancelledSale);
      prismaMock.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) => callback(txMock),
      );

      await service.update(
        'sale-1',
        { status: 'CANCELLED' },
        'user-1',
        'org-1',
      );

      expect(txMock.product.updateMany).toHaveBeenCalledTimes(1);
      expect(txMock.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', organizationId: 'org-1' },
        data: { version: { increment: 1 } },
      });
      expect(siteDelta).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({
          productId: 'prod-1',
          locationId: 'site-default',
          stockDelta: 2,
        }),
      );
      expect(txMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'RETURN', quantity: 2 }),
        }),
      );
    });

    it('aggregates the signed SALE movements per product and skips a line that never moved', async () => {
      const txMock = {
        product: {
          findFirst: jest
            .fn()
            .mockImplementation(({ where }: { where: { id: string } }) =>
              Promise.resolve(
                productRow({ id: where.id, stock: 5, version: 7 }),
              ),
            ),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryMovement: {
          findMany: jest.fn().mockResolvedValue([
            { productId: 'prod-1', quantity: -1 },
            { productId: 'prod-1', quantity: -2 },
            { productId: 'prod-2', quantity: -5 },
          ]),
          create: jest.fn(),
        },
        sale: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
        },
      };
      // prod-3 is on the sale but was never decremented, so it is not touched.
      prismaMock.sale.findFirst
        .mockResolvedValueOnce({
          ...saleWithItem('prod-1', 3),
          items: [
            { id: 'si-1', productId: 'prod-1', quantity: 3 },
            { id: 'si-2', productId: 'prod-2', quantity: 5 },
            { id: 'si-3', productId: 'prod-3', quantity: 4 },
          ],
        })
        .mockResolvedValueOnce(cancelledSale);
      prismaMock.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) => callback(txMock),
      );

      await service.update(
        'sale-1',
        { status: 'CANCELLED' },
        'user-1',
        'org-1',
      );

      const writes = siteDelta.mock.calls as unknown as Array<
        [unknown, { productId: string; stockDelta: number; locationId: string }]
      >;
      expect(
        writes.map(([, delta]) => [delta.productId, delta.stockDelta]),
      ).toEqual([
        ['prod-1', 3],
        ['prod-2', 5],
      ]);
      expect(
        writes.every(([, delta]) => delta.locationId === 'site-default'),
      ).toBe(true);
      expect(txMock.inventoryMovement.create).toHaveBeenCalledTimes(2);
      expect(txMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productId: 'prod-1', quantity: 3 }),
        }),
      );
      expect(txMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productId: 'prod-2', quantity: 5 }),
        }),
      );
    });
  });
});
