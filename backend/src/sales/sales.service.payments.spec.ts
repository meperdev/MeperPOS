import { BadRequestException } from '@nestjs/common';
import { SalesService } from './sales.service';

/**
 * S3 / D1: a mixed payment must never let the POS sell above the final price.
 * A sale may only overpay when the overpayment can come back as change, so
 * `SalesService.create` requires cash and, on a positive total, every tender to be needed:
 * one that could be removed while the rest still covers the total is an
 * overpayment the customer never made. The persisted `change` is the overpaid
 * amount itself, not `cashPaid - total` (a transfer on top of exact cash used to
 * hide the surplus).
 */
describe('SalesService payment rule (S3)', () => {
  const issuedAt = new Date('2026-11-19T15:00:00.000Z');

  const productFor = (total: number) => ({
    id: 'prod-1',
    name: 'Payment fixture',
    type: 'PRODUCT' as const,
    tracksStock: true,
    active: true,
    costPrice: 0,
    salePrice: total,
    taxable: false,
    taxRate: 0,
    taxCode: null,
    stock: 10,
    category: { taxable: false, defaultTaxRate: null, defaultTaxCode: null },
  });

  const buildTx = () => ({
    sale: { create: jest.fn() },
    organization: {
      findFirst: jest.fn().mockResolvedValue({
        taxId: '900123456',
        settings: { electronicInvoicing: { enabled: true } },
      }),
    },
    fiscalDocument: { create: jest.fn().mockResolvedValue({ id: 'fiscal-1' }) },
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
  });

  type Tx = ReturnType<typeof buildTx>;

  let service: SalesService;
  let tx: Tx;
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

  /** Primes a sale of `total` paid with `payments`; returns the tx mock. */
  const prime = (
    total: number,
    payments: Array<{ method: string; amount: number }>,
  ) => {
    tx = buildTx();
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: unknown) => unknown) => callback(tx),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 88,
      formatted: '88',
    });
    prismaMock.product.findFirst.mockResolvedValue(productFor(total));
    tx.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 88,
      createdAt: issuedAt,
    });
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 88,
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    const create = () =>
      service.create(
        {
          items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
          discountAmount: 0,
          payments: payments as never,
        },
        'user-1',
        'org-1',
      );

    return { create };
  };

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

  describe('valid overpayments', () => {
    it('stores the surplus of a single cash tender as change', async () => {
      const { create } = prime(12931, [{ method: 'CASH', amount: 50000 }]);

      await create();

      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amountPaid: 50000, change: 37069 }),
        }),
      );
      // The fiscal snapshot describes the sale it belongs to.
      expect(
        tx.fiscalDocument.create.mock.calls[0][0].data.snapshot,
      ).toMatchObject({
        amountPaid: '50000.00',
        change: '37069.00',
      });
    });

    it('stores the overpaid amount when a cash tender tops up a transfer', async () => {
      const { create } = prime(112931, [
        { method: 'TRANSFER', amount: 100000 },
        { method: 'CASH', amount: 20000 },
      ]);

      await create();

      // paid 120.000 - total 112.931 = 7.069 in change; both tenders are needed
      // (100.000 alone and 20.000 alone each leave the total uncovered).
      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amountPaid: 120000, change: 7069 }),
        }),
      );
      expect(tx.payment.create).toHaveBeenCalledTimes(2);
    });

    it('hands a cash tender back as change on a sale with nothing to collect', async () => {
      // A fully discounted sale (SEC-015) has total 0: no tender can be
      // "needed", so the needed-tender rule cannot apply. Cash still goes back.
      const { create } = prime(0, [{ method: 'CASH', amount: 1000 }]);

      await create();

      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amountPaid: 1000, change: 1000 }),
        }),
      );
    });

    it('stores no change when an exact split covers the total', async () => {
      const { create } = prime(112931, [
        { method: 'TRANSFER', amount: 100000 },
        { method: 'CASH', amount: 12931 },
      ]);

      await create();

      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amountPaid: 112931, change: null }),
        }),
      );
    });

    it('stores no change when a single cash tender matches the total', async () => {
      const { create } = prime(112931, [{ method: 'CASH', amount: 112931 }]);

      await create();

      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ change: null }),
        }),
      );
    });

    it('accepts a zero-amount tender on an exactly paid sale, as the DTO allows it', async () => {
      const { create } = prime(112931, [
        { method: 'CASH', amount: 112931 },
        { method: 'CARD', amount: 0 },
      ]);

      await create();

      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amountPaid: 112931, change: null }),
        }),
      );
    });
  });

  describe('rejected overpayments', () => {
    it('rejects a non-cash tender on an overpaid zero-total sale', async () => {
      const { create } = prime(0, [
        { method: 'CASH', amount: 1000 },
        { method: 'CARD', amount: 1000 },
      ]);

      await expect(create()).rejects.toThrow(
        'Payment CARD (1000) is not needed: the other payments already cover the total (0)',
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a surplus tender that the rest of the payment already covers', async () => {
      const { create } = prime(112931, [
        { method: 'CASH', amount: 112931 },
        { method: 'TRANSFER', amount: 100000 },
      ]);

      await expect(create()).rejects.toThrow(
        new BadRequestException(
          'Payment TRANSFER (100000) is not needed: the other payments already cover the total (112931)',
        ),
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an overpayment with no cash tender, since no change can be given', async () => {
      const { create } = prime(112931, [{ method: 'CARD', amount: 120000 }]);

      await expect(create()).rejects.toThrow(
        new BadRequestException(
          'Change (7069) can only be handed back in cash: card and transfer payments never return change',
        ),
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an overpayment split between a transfer and a card', async () => {
      const { create } = prime(112931, [
        { method: 'TRANSFER', amount: 50000 },
        { method: 'CARD', amount: 70000 },
      ]);

      await expect(create()).rejects.toThrow(
        new BadRequestException(
          'Change (7069) can only be handed back in cash: card and transfer payments never return change',
        ),
      );
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('rejects a zero-amount tender that adds nothing to an overpaid sale', async () => {
      const { create } = prime(112931, [
        { method: 'CASH', amount: 120000 },
        { method: 'CARD', amount: 0 },
      ]);

      await expect(create()).rejects.toThrow(
        new BadRequestException(
          'Payment CARD (0) is not needed: the other payments already cover the total (112931)',
        ),
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('underpayment (unchanged)', () => {
    it('keeps rejecting a payment below the total with the original message', async () => {
      const { create } = prime(112931, [{ method: 'CASH', amount: 100000 }]);

      await expect(create()).rejects.toThrow(
        new BadRequestException(
          'Total paid (100000) is less than total (112931)',
        ),
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
