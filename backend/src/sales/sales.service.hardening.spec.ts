import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesService } from './sales.service';

/**
 * FASE 7 commercial-integrity hardening (docs/security/FINDINGS.md):
 *
 * - SEC-012: a serialization failure or a `saleNumber` collision is a conflict
 *   of the point of sale, never a 500: the create retries the whole transaction
 *   once and then answers 409.
 * - SEC-014: an optional `requestKey` makes the create idempotent: the same key
 *   and payload replay the sale it already registered.
 * - SEC-015: the sale-wide discount reduces the taxable base before each line's
 *   tax is computed, and can never exceed the gross subtotal.
 */
describe('SalesService — commercial integrity (SEC-012/014/015)', () => {
  type Tx = {
    sale: { create: jest.Mock };
    saleItem: { create: jest.Mock };
    product: { findFirst: jest.Mock; updateMany: jest.Mock };
    inventoryMovement: { create: jest.Mock };
    payment: { create: jest.Mock };
    auditLog: { create: jest.Mock };
    organization: { findFirst: jest.Mock };
    fiscalDocument: { create: jest.Mock };
  };

  const issuedAt = new Date('2026-11-19T15:00:00.000Z');

  const productFixture = (overrides: Record<string, unknown> = {}) => ({
    id: 'prod-1',
    name: 'Product',
    type: 'PRODUCT',
    tracksStock: true,
    active: true,
    costPrice: 50,
    salePrice: 100,
    taxable: true,
    taxRate: 19,
    taxCode: 'IVA',
    stock: 10,
    category: {
      taxable: false,
      defaultTaxRate: null,
      defaultTaxCode: null,
    },
    ...overrides,
  });

  const taxedProduct = productFixture();
  const untaxedProduct = productFixture({
    id: 'prod-2',
    name: 'Untaxed',
    salePrice: 300,
    taxable: false,
    taxRate: 0,
    taxCode: null,
  });

  const buildTx = (): Tx => ({
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
        taxId: null,
        settings: {},
      }),
    },
    fiscalDocument: { create: jest.fn().mockResolvedValue({ id: 'fiscal-1' }) },
  });

  const prismaMock = {
    $transaction: jest.fn(),
    sale: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    product: { findFirst: jest.fn() },
    customer: { findFirst: jest.fn() },
    posLoanSaleIntent: { findFirst: jest.fn() },
  };
  const cacheMock = { clear: jest.fn() };
  const settingsServiceMock = { find: jest.fn() };
  const sequenceServiceMock = { nextNumber: jest.fn() };
  const receiptsServiceMock = { generateSaleReceiptPdf: jest.fn() };

  const detailSale = {
    id: 'sale-new',
    saleNumber: 77,
    userId: 'user-1',
    user: { id: 'user-1', name: 'User', email: 'user@example.com' },
    customer: null,
    items: [],
    payments: [],
    posLoanSaleIntent: null,
  };

  let service: SalesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SalesService(
      prismaMock as never,
      cacheMock as never,
      settingsServiceMock as never,
      sequenceServiceMock as never,
      receiptsServiceMock as never,
    );
    prismaMock.sale.findFirst.mockImplementation((args: unknown) => {
      const query = args as {
        where?: { requestKeyHash?: unknown };
        include?: { items?: unknown };
      };
      if (query.where?.requestKeyHash !== undefined) {
        return Promise.resolve(null);
      }
      if (query.include?.items === true) {
        return Promise.resolve(detailSale);
      }
      return Promise.resolve(detailSale);
    });
  });

  const prime = (tx: Tx, products: Record<string, unknown>[]) => {
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: Tx) => unknown) => callback(tx),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 77,
      formatted: '77',
    });
    prismaMock.product.findFirst.mockImplementation(
      async (args: { where: { id: string } }) => {
        const product = products.find((row) => row.id === args.where.id);
        if (!product) throw new Error(`Unexpected product ${args.where.id}`);
        return product;
      },
    );
    prismaMock.customer.findFirst.mockResolvedValue(null);
    tx.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 77,
      createdAt: issuedAt,
    });
    tx.saleItem.create.mockImplementation((args: { data: object }) =>
      Promise.resolve({
        id: `item-${tx.saleItem.create.mock.calls.length}`,
        ...args.data,
      }),
    );
  };

  const createDto = (
    items: Array<{
      productId: string;
      quantity: number;
      discountAmount?: number;
    }>,
    extra: { discountAmount?: number; requestKey?: string } = {},
  ) => ({
    items,
    payments: [{ method: 'CASH' as const, amount: 1000 }],
    ...extra,
  });

  const createdSaleData = (tx: Tx) => tx.sale.create.mock.calls[0][0].data;
  const createdItems = (tx: Tx) =>
    tx.saleItem.create.mock.calls.map(
      (call: Array<{ data: Record<string, unknown> }>) => call[0].data,
    );

  const prismaError = (
    code: string,
    meta?: Record<string, unknown>,
    message = 'database error',
  ) =>
    new Prisma.PrismaClientKnownRequestError(message, {
      code,
      clientVersion: '6.0.0',
      ...(meta ? { meta } : {}),
    });

  // ---- SEC-015: sale-wide discount is a pre-VAT reduction with a clamp ----

  describe('SEC-015 sale-wide discount', () => {
    it('rejects a discount larger than the gross subtotal', async () => {
      const tx = buildTx();
      prime(tx, [untaxedProduct]);

      await expect(
        service.create(
          createDto([{ productId: 'prod-2', quantity: 1 }], {
            discountAmount: 300.01,
          }),
          'user-1',
          'org-1',
        ),
      ).rejects.toThrow(
        new BadRequestException('El descuento no puede exceder el subtotal'),
      );

      // Rejected before any write: no sale, no stock movement.
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('charges tax on the discounted base instead of the gross subtotal', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);

      await service.create(
        createDto([{ productId: 'prod-1', quantity: 2 }], {
          discountAmount: 100,
        }),
        'user-1',
        'org-1',
      );

      // 200 gross − 100 discount = 100 taxable base → 19 tax, not 38.
      expect(createdSaleData(tx)).toMatchObject({
        subtotal: 200,
        discountAmount: 100,
        taxAmount: 19,
        total: 119,
      });
      expect(createdItems(tx)).toEqual([
        expect.objectContaining({ subtotal: 200, taxAmount: 19, total: 119 }),
      ]);
    });

    it("distributes the discount across lines before each line's tax", async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct, untaxedProduct]);

      await service.create(
        createDto(
          [
            { productId: 'prod-1', quantity: 1 },
            { productId: 'prod-2', quantity: 1 },
          ],
          { discountAmount: 40 },
        ),
        'user-1',
        'org-1',
      );

      // 400 gross − 40 discount: 10% per line → 90 taxed at 19% and 270 untaxed.
      expect(createdSaleData(tx)).toMatchObject({
        subtotal: 400,
        discountAmount: 40,
        taxAmount: 17.1,
        total: 377.1,
      });
      expect(createdItems(tx)).toEqual([
        expect.objectContaining({
          subtotal: 100,
          taxAmount: 17.1,
          total: 107.1,
        }),
        expect.objectContaining({
          subtotal: 300,
          taxCode: null,
          taxAmount: null,
          total: 270,
        }),
      ]);
    });

    it('accepts a discount that consumes the whole subtotal', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);

      await service.create(
        createDto([{ productId: 'prod-1', quantity: 1 }], {
          discountAmount: 100,
        }),
        'user-1',
        'org-1',
      );

      expect(createdSaleData(tx)).toMatchObject({
        subtotal: 100,
        discountAmount: 100,
        taxAmount: 0,
        total: 0,
      });
      // The code-iff-positive-tax invariant survives the empty base.
      expect(createdItems(tx)).toEqual([
        expect.objectContaining({ taxCode: null, taxAmount: null, total: 0 }),
      ]);
    });

    it('tolerates the float artifact of a subtotal equal to the discount', async () => {
      const tx = buildTx();
      prime(tx, [
        untaxedProduct,
        { ...untaxedProduct, id: 'prod-3', salePrice: 0.7 },
      ]);

      // 0.7 × 3 is 2.0999999999999996 in JS; the discount that reaches the
      // stored DECIMAL(10,2) subtotal is exactly 2.10 and must be accepted.
      await service.create(
        createDto([{ productId: 'prod-3', quantity: 3 }], {
          discountAmount: 2.1,
        }),
        'user-1',
        'org-1',
      );

      expect(createdSaleData(tx)).toMatchObject({
        subtotal: 2.0999999999999996,
        discountAmount: 2.1,
        total: 0,
      });
    });

    it('keeps the ordinary no-discount sale unchanged', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);

      await service.create(
        createDto([{ productId: 'prod-1', quantity: 1 }]),
        'user-1',
        'org-1',
      );

      expect(createdSaleData(tx)).toMatchObject({
        subtotal: 100,
        discountAmount: 0,
        taxAmount: 19,
        total: 119,
      });
    });
  });

  // ---- SEC-012: conflicts of the point of sale answer 409, never 500 ----

  describe('SEC-012 concurrency mapping', () => {
    it('retries the whole transaction once after a serialization failure', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);
      prismaMock.$transaction
        .mockRejectedValueOnce(
          prismaError('P2034', undefined, 'could not serialize access'),
        )
        .mockImplementation(async (callback: (client: Tx) => unknown) =>
          callback(tx),
        );

      const sale = await service.create(
        createDto([{ productId: 'prod-1', quantity: 1 }]),
        'user-1',
        'org-1',
      );

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
      expect(sale).toMatchObject({ id: 'sale-new' });
      // The retry is one more whole transaction, never a partial replay.
      expect(tx.sale.create).toHaveBeenCalledTimes(1);
    });

    it('answers 409 when the retry also hits a serialization failure', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);
      prismaMock.$transaction.mockRejectedValue(
        prismaError('P2034', undefined, 'could not serialize access'),
      );

      const failure = service.create(
        createDto([{ productId: 'prod-1', quantity: 1 }]),
        'user-1',
        'org-1',
      );

      await expect(failure).rejects.toBeInstanceOf(ConflictException);
      await expect(failure).rejects.toThrow(
        'La venta no pudo completarse por concurrencia, reintentá',
      );
      await expect(failure).rejects.toMatchObject({ status: 409 });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    it('retries the whole transaction once after a saleNumber collision', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);
      prismaMock.$transaction
        .mockRejectedValueOnce(
          prismaError('P2002', {
            target: ['organizationId', 'saleNumber'],
          }),
        )
        .mockImplementation(async (callback: (client: Tx) => unknown) =>
          callback(tx),
        );

      await service.create(
        createDto([{ productId: 'prod-1', quantity: 1 }]),
        'user-1',
        'org-1',
      );

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
      expect(tx.sale.create).toHaveBeenCalledTimes(1);
    });

    it('answers 409 when the retry also collides on the sale number', async () => {
      prime(buildTx(), [taxedProduct]);
      prismaMock.$transaction.mockRejectedValue(
        prismaError('P2002', { target: ['organizationId', 'saleNumber'] }),
      );

      await expect(
        service.create(
          createDto([{ productId: 'prod-1', quantity: 1 }]),
          'user-1',
          'org-1',
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: 'La venta no pudo completarse por concurrencia, reintentá',
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    });

    it('retries the raw-query serialization failure Prisma reports as P2010', async () => {
      // `SELECT ... FOR UPDATE` fails inside `$queryRaw`, and Prisma reports
      // PostgreSQL's 40001 as P2010 with the database code in `meta`, not as
      // P2034. That is the code a real concurrent POS sees.
      const tx = buildTx();
      prime(tx, [taxedProduct]);
      prismaMock.$transaction
        .mockRejectedValueOnce(
          prismaError(
            'P2010',
            {
              code: '40001',
              message: 'could not serialize access due to concurrent update',
            },
            'Raw query failed. Code: `40001`',
          ),
        )
        .mockImplementation(async (callback: (client: Tx) => unknown) =>
          callback(tx),
        );

      await service.create(
        createDto([{ productId: 'prod-1', quantity: 1 }]),
        'user-1',
        'org-1',
      );

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    });

    it('answers 409 when the raw serialization failure repeats', async () => {
      prime(buildTx(), [taxedProduct]);
      prismaMock.$transaction.mockRejectedValue(
        prismaError(
          'P2010',
          {
            code: '40001',
            message: 'could not serialize access due to concurrent update',
          },
          'Raw query failed. Code: `40001`',
        ),
      );

      await expect(
        service.create(
          createDto([{ productId: 'prod-1', quantity: 1 }]),
          'user-1',
          'org-1',
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: 'La venta no pudo completarse por concurrencia, reintentá',
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    });

    it('keeps mapping P2028 to 503 without burning the retry', async () => {
      prime(buildTx(), [taxedProduct]);
      prismaMock.$transaction.mockRejectedValue(prismaError('P2028'));

      await expect(
        service.create(
          createDto([{ productId: 'prod-1', quantity: 1 }]),
          'user-1',
          'org-1',
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('never retries a business conflict raised inside the transaction', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);
      prismaMock.$transaction.mockImplementation(async () => {
        throw new ConflictException('Insufficient stock for product prod-1');
      });

      await expect(
        service.create(
          createDto([{ productId: 'prod-1', quantity: 1 }]),
          'user-1',
          'org-1',
        ),
      ).rejects.toThrow('Insufficient stock for product prod-1');
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ---- SEC-014: optional idempotency key ----

  describe('SEC-014 idempotency key', () => {
    const requestKey = 'venta-clave-0001';

    const replayLookup = () =>
      prismaMock.sale.findFirst.mock.calls.find(
        (call: Array<{ where?: { requestKeyHash?: unknown } }>) =>
          call[0]?.where?.requestKeyHash !== undefined,
      )?.[0];

    it('persists the SHA-256 of the request and replays that exact sale', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);
      const dto = createDto([{ productId: 'prod-1', quantity: 1 }], {
        requestKey,
      });

      const first = await service.create(dto, 'user-1', 'org-1');
      const hash = createdSaleData(tx).requestKeyHash as string;

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      // The plaintext key is never stored.
      expect(JSON.stringify(createdSaleData(tx))).not.toContain(requestKey);
      expect(first).toMatchObject({ id: 'sale-new' });

      // The retry finds that hash before the transaction and replays it.
      prismaMock.sale.findFirst.mockImplementation((args: unknown) => {
        const query = args as { where?: { requestKeyHash?: unknown } };
        if (query.where?.requestKeyHash !== undefined) {
          return Promise.resolve({ id: 'sale-existente' });
        }
        return Promise.resolve({ ...detailSale, id: 'sale-existente' });
      });

      const replayed = await service.create(dto, 'user-1', 'org-1');

      expect(replayLookup()).toEqual({
        where: { organizationId: 'org-1', requestKeyHash: hash },
        select: { id: true },
      });
      expect(replayed).toMatchObject({ id: 'sale-existente' });
      // One transaction for the original sale, none for the replay.
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('keeps different payloads behind different hashes for the same key', async () => {
      const firstTx = buildTx();
      prime(firstTx, [taxedProduct]);
      await service.create(
        createDto([{ productId: 'prod-1', quantity: 1 }], { requestKey }),
        'user-1',
        'org-1',
      );
      const firstHash = createdSaleData(firstTx).requestKeyHash as string;

      const secondTx = buildTx();
      prime(secondTx, [taxedProduct]);
      await service.create(
        createDto([{ productId: 'prod-1', quantity: 2 }], { requestKey }),
        'user-1',
        'org-1',
      );
      const secondHash = createdSaleData(secondTx).requestKeyHash as string;

      expect(secondHash).not.toBe(firstHash);
    });

    it('replays the winner of a race on the requestKey unique index', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);
      const dto = createDto([{ productId: 'prod-1', quantity: 1 }], {
        requestKey,
      });

      prismaMock.$transaction.mockRejectedValue(
        prismaError('P2002', {
          target: ['organizationId', 'requestKeyHash'],
        }),
      );
      // The pre-transaction read finds nothing (this request created it); only
      // the race loser's post-conflict read finds the winner.
      let replayLookups = 0;
      prismaMock.sale.findFirst.mockImplementation((args: unknown) => {
        const query = args as { where?: { requestKeyHash?: unknown } };
        if (query.where?.requestKeyHash !== undefined) {
          replayLookups += 1;
          return Promise.resolve(
            replayLookups === 1 ? null : { id: 'sale-ganadora' },
          );
        }
        return Promise.resolve({ ...detailSale, id: 'sale-ganadora' });
      });

      const sale = await service.create(dto, 'user-1', 'org-1');

      expect(sale).toMatchObject({ id: 'sale-ganadora' });
      // The race is settled by replay, not by a second sale or a 409.
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    it.each(['site-a', 'site-b'])(
      'checks the winning sale origin %s after a key collision',
      async (locationId) => {
        const tx = buildTx();
        prime(tx, [taxedProduct]);
        const dto = {
          ...createDto([{ productId: 'prod-1', quantity: 1 }], { requestKey }),
          locationId: 'site-a',
        };
        prismaMock.$transaction.mockRejectedValue(
          prismaError('P2002', {
            target: ['organizationId', 'requestKeyHash'],
          }),
        );
        let lookups = 0;
        prismaMock.sale.findFirst.mockImplementation(
          (args: { where?: { requestKeyHash?: unknown } }) => {
            if (args.where?.requestKeyHash !== undefined) {
              lookups += 1;
              return Promise.resolve(
                lookups === 1
                  ? null
                  : {
                      id: 'sale-ganadora',
                      originSite: { locationId },
                    },
              );
            }
            return Promise.resolve({ ...detailSale, id: 'sale-ganadora' });
          },
        );
        const result = service.create(dto, 'user-1', 'org-1');
        if (locationId === 'site-a') {
          await expect(result).resolves.toMatchObject({ id: 'sale-ganadora' });
        } else {
          await expect(result).rejects.toMatchObject({
            status: 409,
            message:
              'La solicitud ya corresponde a una venta con otra atribución de sede',
          });
        }
        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.sale.create).not.toHaveBeenCalled();
      },
    );

    it('keeps sales without a key outside the idempotency path', async () => {
      const tx = buildTx();
      prime(tx, [taxedProduct]);

      await service.create(
        createDto([{ productId: 'prod-1', quantity: 1 }]),
        'user-1',
        'org-1',
      );

      expect(createdSaleData(tx).requestKeyHash).toBeNull();
      expect(replayLookup()).toBeUndefined();
    });
  });

  // ---- SEC-013: RETURNED_PARTIAL is out of the update contract ----

  describe('SEC-013 RETURNED_PARTIAL', () => {
    it('no longer writes a bare RETURNED_PARTIAL status', async () => {
      prismaMock.sale.findFirst.mockResolvedValue({
        ...detailSale,
        status: 'COMPLETED',
        organizationId: 'org-1',
        items: [],
        payments: [],
        customer: null,
      });

      await service.update(
        'sale-new',
        { status: 'RETURNED_PARTIAL' } as never,
        'user-1',
        'org-1',
      );

      expect(prismaMock.sale.update).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('returns the sale unchanged when the update carries no status', async () => {
      prismaMock.sale.findFirst.mockResolvedValue({
        ...detailSale,
        status: 'COMPLETED',
        organizationId: 'org-1',
        items: [],
        payments: [],
        customer: null,
      });

      const sale = await service.update('sale-new', {}, 'user-1', 'org-1');

      expect(sale).toMatchObject({ id: 'sale-new' });
      expect(prismaMock.sale.update).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
