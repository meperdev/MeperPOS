import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildSaleQuote } from './sale-pricing';
import { prepareSaleQuoteForStorage } from './sale-quote-storage';

type Quote = ReturnType<typeof buildSaleQuote>;
const makeRows = () => [
  {
    productId: 'first',
    quantity: 2,
    unitPrice: 10.005,
    discountAmount: 0.005,
    taxRate: 19,
    costPriceSnapshot: new Prisma.Decimal(5),
  },
  {
    productId: 'second',
    quantity: 1,
    unitPrice: 0,
    discountAmount: 0,
    taxRate: 0,
    costPriceSnapshot: new Prisma.Decimal(0),
  },
];
const makeQuote = (total = 123.455) => buildSaleQuote(makeRows(), total);
const withItem = (patch: Partial<Quote['items'][number]>): Quote => {
  const quote = makeQuote();
  return { ...quote, items: [{ ...quote.items[0], ...patch }] };
};

// Pure adapter coverage: no database, financial activation or ordinary-sale math.
describe('prepareSaleQuoteForStorage', () => {
  it('owns a canonical JSON snapshot and one authoritative Decimal, without summing rows', () => {
    const prepared = prepareSaleQuoteForStorage(makeQuote());
    const json: Prisma.InputJsonObject = prepared.snapshot;
    expect(json).toBe(prepared.snapshot);
    expect(prepared.agreedCustomerTotal).toBeInstanceOf(Prisma.Decimal);
    expect(prepared.agreedCustomerTotal.toFixed(2)).toBe('123.46');
    expect(prepared.snapshot.agreedCustomerTotal).toBe(
      prepared.agreedCustomerTotal.toFixed(2),
    );
    // Future transaction callers reuse this instance, not a separate conversion.
    const loanData = { amount: prepared.agreedCustomerTotal };
    const intentData = { agreedCustomerTotal: prepared.agreedCustomerTotal };
    expect(loanData.amount).toBe(intentData.agreedCustomerTotal);
    expect(prepared.snapshot.items).toEqual([
      {
        productId: 'first',
        quantity: 2,
        resolvedUnitPrice: '10.01',
        discountAmount: '0.01',
        taxRate: 19,
        costPriceSnapshot: '5.00',
      },
      {
        productId: 'second',
        quantity: 1,
        resolvedUnitPrice: '0.00',
        discountAmount: '0.00',
        taxRate: 0,
        costPriceSnapshot: '0.00',
      },
    ]);
  });

  it.each<[number, string]>([
    [1.005, '1.01'],
    [2.675, '2.68'],
    [0.005, '0.01'],
    [1.004, '1.00'],
  ])('uses explicit HALF_UP for header and row money %s', (value, expected) => {
    const quote = withItem({ resolvedUnitPrice: value, discountAmount: value });
    const prepared = prepareSaleQuoteForStorage({
      ...quote,
      agreedCustomerTotal: value,
    });
    expect(prepared.snapshot.agreedCustomerTotal).toBe(expected);
    expect(prepared.snapshot.items[0].resolvedUnitPrice).toBe(expected);
    expect(prepared.snapshot.items[0].discountAmount).toBe(expected);
  });

  it('accepts the normalized Decimal(10,2) maximum for every money field', () => {
    const quote = withItem({
      resolvedUnitPrice: 99999999.994,
      discountAmount: 99999999.994,
    });
    const prepared = prepareSaleQuoteForStorage({
      ...quote,
      agreedCustomerTotal: 99999999.994,
    });
    expect(prepared.agreedCustomerTotal.toFixed(2)).toBe('99999999.99');
    expect(prepared.snapshot.items[0].resolvedUnitPrice).toBe('99999999.99');
    expect(prepared.snapshot.items[0].discountAmount).toBe('99999999.99');
  });

  describe.each([
    'agreedCustomerTotal',
    'resolvedUnitPrice',
    'discountAmount',
  ] as const)('%s eligibility', (field) => {
    it.each([-1, -0.001, NaN, Infinity, -Infinity, 99999999.995, 100000000])(
      'rejects invalid raw or post-rounding money %s as BadRequestException',
      (value) => {
        const quote =
          field === 'agreedCustomerTotal'
            ? makeQuote(value)
            : withItem({ [field]: value });
        expect(() => prepareSaleQuoteForStorage(quote)).toThrow(
          BadRequestException,
        );
      },
    );
  });

  it.each([0, -0, 0.001, 0.004])(
    'rejects a header %s that normalizes to zero',
    (total) => {
      expect(() => prepareSaleQuoteForStorage(makeQuote(total))).toThrow(
        BadRequestException,
      );
    },
  );

  it('permits zero and mathematical negative zero for row money', () => {
    const prepared = prepareSaleQuoteForStorage(
      withItem({ resolvedUnitPrice: -0, discountAmount: 0 }),
    );
    expect(prepared.snapshot.items[0].resolvedUnitPrice).toBe('0.00');
    expect(prepared.snapshot.items[0].discountAmount).toBe('0.00');
  });

  it('rejects an empty quote', () => {
    expect(() =>
      prepareSaleQuoteForStorage({ items: [], agreedCustomerTotal: 1 }),
    ).toThrow(BadRequestException);
  });

  it.each([0, -1, 1.5, 2147483648, NaN, Infinity, -Infinity])(
    'rejects quantity %s outside the positive Prisma Int contract',
    (quantity) => {
      expect(() => prepareSaleQuoteForStorage(withItem({ quantity }))).toThrow(
        BadRequestException,
      );
    },
  );

  it('accepts the largest Prisma Int without recalculating the header', () => {
    const prepared = prepareSaleQuoteForStorage(
      withItem({ quantity: 2147483647 }),
    );
    expect(prepared.snapshot.items[0].quantity).toBe(2147483647);
    expect(prepared.snapshot.agreedCustomerTotal).toBe('123.46');
  });

  it.each(['', ' ', '\t\n', null, undefined, 123])(
    'rejects blank or nonstring product ID %s',
    (productId) => {
      const quote = withItem({ productId: productId as unknown as string });
      expect(() => prepareSaleQuoteForStorage(quote)).toThrow(
        BadRequestException,
      );
    },
  );

  it('preserves nonblank ID text, row order and resolved tax/cost metadata', () => {
    const input = makeQuote();
    const quote = {
      ...input,
      taxRate: 19,
      items: input.items.map((item) => ({
        ...item,
        productId: ` ${item.productId} `,
        taxRate: 19,
        costPriceSnapshot: new Prisma.Decimal(5),
      })),
    };
    const prepared = prepareSaleQuoteForStorage(quote);
    expect(Object.keys(prepared.snapshot).sort()).toEqual([
      'agreedCustomerTotal',
      'discountAmount',
      'items',
    ]);
    expect(prepared.snapshot.items.map((item) => item.productId)).toEqual([
      ' first ',
      ' second ',
    ]);
    for (const item of prepared.snapshot.items) {
      expect(Object.keys(item).sort()).toEqual([
        'costPriceSnapshot',
        'discountAmount',
        'productId',
        'quantity',
        'resolvedUnitPrice',
        'taxRate',
      ]);
    }
    expect(prepared.agreedCustomerTotal).not.toBe(
      quote.items[0].costPriceSnapshot,
    );
  });

  it('copies and freezes owned JSON and the prepared root, not input or Decimal internals', () => {
    const rows = makeRows();
    const quote = buildSaleQuote(rows, 123.455);
    const input = {
      ...quote,
      items: quote.items.map((item) => ({ ...item })),
    };
    const prepared = prepareSaleQuoteForStorage(input);
    expect(prepared.snapshot).not.toBe(input);
    expect(prepared.snapshot.items).not.toBe(input.items);
    expect(prepared.snapshot.items[0]).not.toBe(input.items[0]);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.snapshot)).toBe(true);
    expect(Object.isFrozen(prepared.snapshot.items)).toBe(true);
    expect(prepared.snapshot.items.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(prepared.agreedCustomerTotal)).toBe(false);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.items[0])).toBe(false);
    input.items[0].resolvedUnitPrice = 900;
    input.items[0].productId = 'changed';
    input.agreedCustomerTotal = 999;
    rows[0].unitPrice = 500;
    expect(prepared.snapshot.items[0].resolvedUnitPrice).toBe('10.01');
    expect(prepared.snapshot.items[0].productId).toBe('first');
    expect(prepared.agreedCustomerTotal.toFixed(2)).toBe('123.46');
    expect(quote.items[0].resolvedUnitPrice).toBe(10.005);
    expect(quote.agreedCustomerTotal).toBe(123.455);
    expect(Reflect.set(prepared.snapshot.items[0], 'quantity', 9)).toBe(false);
  });

  it.each([-1, NaN, Infinity, 100000000])(
    'rejects invalid sale-wide discount %s',
    (discountAmount) => {
      expect(() =>
        prepareSaleQuoteForStorage({ ...makeQuote(), discountAmount }),
      ).toThrow(BadRequestException);
    },
  );

  it.each([-1, NaN, Infinity, 1000, 0.001])(
    'rejects invalid resolved tax rate %s',
    (taxRate) => {
      expect(() => prepareSaleQuoteForStorage(withItem({ taxRate }))).toThrow(
        BadRequestException,
      );
    },
  );

  it.each([-1, NaN, Infinity, 100000000])(
    'rejects invalid resolved cost %s',
    (cost) => {
      const quote = withItem({ costPriceSnapshot: new Prisma.Decimal(cost) });
      expect(() => prepareSaleQuoteForStorage(quote)).toThrow(
        BadRequestException,
      );
    },
  );

  it('retains resolved line tax/cost metadata and a provided sale-wide discount', () => {
    const quote = makeQuote();
    const enriched = {
      ...quote,
      discountAmount: 10,
      items: quote.items.map((item, index) => ({
        ...item,
        taxRate: index === 0 ? 19 : 0,
        costPriceSnapshot: new Prisma.Decimal(index === 0 ? 5 : 0),
      })),
    };
    const prepared = prepareSaleQuoteForStorage(enriched);
    expect(Object.keys(prepared.snapshot).sort()).toEqual([
      'agreedCustomerTotal',
      'discountAmount',
      'items',
    ]);
    expect(prepared.snapshot).toMatchObject({ discountAmount: '10.00' });
    expect(prepared.snapshot.items[0]).toEqual(
      expect.objectContaining({
        taxRate: 19,
        costPriceSnapshot: '5.00',
      }),
    );
    expect(Object.keys(prepared.snapshot.items[0]).sort()).toEqual([
      'costPriceSnapshot',
      'discountAmount',
      'productId',
      'quantity',
      'resolvedUnitPrice',
      'taxRate',
    ]);
  });
});
