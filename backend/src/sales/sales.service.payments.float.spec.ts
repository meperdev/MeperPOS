import { SalesService } from './sales.service';

/**
 * S3 / D1, cents boundary: the POS total is a JS float while the server persists
 * each line tax rounded to cents, so a taxed price that is not a multiple of 10
 * leaves the two totals a fraction of a cent apart (net 1006 at 19% → the server
 * total is 1197.1399999999999). A payment of the displayed total is NOT an
 * overpayment: it must be accepted with no change, and it must never be refused
 * for a surplus no decimal column can hold.
 */
describe('SalesService payment rule — cents boundary (S3)', () => {
  const issuedAt = new Date('2026-11-19T15:00:00.000Z');
  // Displayed total the cashier reads: net 1006 + 19% tax rounded to cents.
  const netPrice = 1006;
  const displayedTotal = 1197.14;

  const taxedProduct = (price: number) => ({
    id: 'prod-1',
    name: 'Taxed float fixture',
    type: 'PRODUCT' as const,
    tracksStock: true,
    active: true,
    costPrice: 0,
    salePrice: price,
    taxable: true,
    taxRate: 19,
    taxCode: 'IVA' as const,
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

  const prime = (payments: Array<{ method: string; amount: number }>) => {
    tx = buildTx();
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: unknown) => unknown) => callback(tx),
    );
    sequenceServiceMock.nextNumber.mockResolvedValue({
      number: 90,
      formatted: '90',
    });
    prismaMock.product.findFirst.mockResolvedValue(taxedProduct(netPrice));
    tx.sale.create.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 90,
      createdAt: issuedAt,
    });
    prismaMock.sale.findFirst.mockResolvedValue({
      id: 'sale-new',
      saleNumber: 90,
      userId: 'user-1',
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      customer: null,
      items: [],
      payments: [],
    });

    return () =>
      service.create(
        {
          items: [{ productId: 'prod-1', quantity: 1, discountAmount: 0 }],
          discountAmount: 0,
          payments: payments as never,
        },
        'user-1',
        'org-1',
      );
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

  it('accepts a card at the displayed total when the line tax rounds to cents', async () => {
    // Before the cents rounding this threw "Change (2.27e-13) can only be handed
    // back in cash": a sub-cent float residue is not an overpayment.
    const create = prime([{ method: 'CARD', amount: displayedTotal }]);

    await create();

    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountPaid: displayedTotal,
          change: null,
        }),
      }),
    );
  });

  it('stores no change for a cash payment a fraction of a cent above the total', async () => {
    const create = prime([{ method: 'CASH', amount: displayedTotal }]);

    prismaMock.sale.findFirst.mockImplementation(async () => {
      const { amountPaid, change } = tx.sale.create.mock.calls[0][0].data;
      return { id: 'sale-new', amountPaid, change, items: [], payments: [] };
    });

    await expect(create()).resolves.toMatchObject({
      id: 'sale-new',
      amountPaid: displayedTotal,
      change: null,
    });

    // A non-null residue would be persisted as 0.00 by DECIMAL(10,2) while the
    // receipt and the API reported a change that does not exist.
    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountPaid: displayedTotal,
          change: null,
        }),
      }),
    );
    expect(
      tx.fiscalDocument.create.mock.calls[0][0].data.snapshot,
    ).toMatchObject({
      change: null,
    });
  });
});
