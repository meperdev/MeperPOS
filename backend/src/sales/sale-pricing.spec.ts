import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Category, Prisma, Product, PromotionType } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateSaleDto, SaleItemDto } from './dto/sales.dto';
import { SalesService } from './sales.service';
import {
  buildSaleQuote,
  reconcileLineTaxes,
  resolveSaleItemPricing,
  saleLinesReconcile,
  saleMoneyReconciles,
  toPersistedLineTax,
} from './sale-pricing';

type PricingProduct = Pick<
  Product,
  | 'id'
  | 'name'
  | 'active'
  | 'type'
  | 'tracksStock'
  | 'costPrice'
  | 'salePrice'
  | 'promotionType'
  | 'promotionValue'
  | 'taxable'
  | 'taxRate'
  | 'taxCode'
> & {
  category: Pick<Category, 'taxable' | 'defaultTaxRate' | 'defaultTaxCode'>;
};

const productFixture = (
  overrides: Partial<PricingProduct> = {},
): PricingProduct => ({
  id: 'product-1',
  name: 'Coffee',
  active: true,
  type: 'PRODUCT',
  tracksStock: true,
  costPrice: new Prisma.Decimal(40),
  salePrice: new Prisma.Decimal(100),
  promotionType: PromotionType.PERCENTAGE,
  promotionValue: new Prisma.Decimal(20),
  taxable: true,
  taxRate: new Prisma.Decimal(19),
  taxCode: null,
  category: {
    taxable: true,
    defaultTaxRate: new Prisma.Decimal(10),
    defaultTaxCode: null,
  },
  ...overrides,
});

const actor = (role: RequestUser['role']): RequestUser => ({
  userId: 'user-1',
  email: 'seller@example.com',
  organizationId: 'org-1',
  role,
  tokenVersion: 0,
  isSuperAdmin: false,
});

type PricingCase = {
  name: string;
  product?: Partial<PricingProduct>;
  item?: Partial<SaleItemDto>;
  role?: RequestUser['role'];
  total?: number;
  error?: string;
  forbidden?: boolean;
};

const cases: PricingCase[] = [
  {
    name: 'promotion and product tax precede category tax; order discount follows tax',
    total: 173.5,
  },
  {
    name: 'category tax applies when product tax is disabled',
    product: { taxable: false },
    total: 160,
  },
  {
    name: 'CASHIER can raise the promotional price',
    role: 'CASHIER',
    item: { unitPrice: 120 },
    total: 268.7,
  },
  {
    name: 'CASHIER can lower the promotional price',
    role: 'CASHIER',
    item: { unitPrice: 60 },
    total: 125.9,
  },
  {
    name: 'ADMIN can override the promotional price',
    role: 'ADMIN',
    item: { unitPrice: 120 },
    total: 268.7,
  },
  {
    name: 'missing actor cannot override even with an excessive discount',
    item: { unitPrice: 120, discountAmount: 999 },
    forbidden: true,
    error:
      'Only an ADMIN, OWNER, SUPER_ADMIN or CASHIER may override the unit price of Coffee',
  },
  {
    name: 'negative price is rejected before override permission',
    item: { unitPrice: -1 },
    error: 'Unit price for product Coffee cannot be negative',
  },
  {
    name: 'line discount cannot exceed promotional gross subtotal',
    item: { discountAmount: 161 },
    error: 'Item discount for product Coffee cannot exceed item subtotal',
  },
];

describe('buildSaleQuote value ownership', () => {
  const resolvedRow = () =>
    resolveSaleItemPricing(
      productFixture(),
      { quantity: 2, discountAmount: 10 },
      false,
    ).pricedItem;

  it('copies only quote primitives in order without recalculating money', () => {
    const rows = [
      { ...resolvedRow(), extraUserInput: { note: 'not quote data' } },
      {
        ...resolvedRow(),
        productId: 'free-item',
        quantity: 3,
        unitPrice: 0,
        discountAmount: 0.125,
      },
    ];
    const quote = buildSaleQuote(rows, 123.456789);
    expect(quote).toEqual({
      items: [
        {
          productId: 'product-1',
          quantity: 2,
          resolvedUnitPrice: 80,
          discountAmount: 10,
          taxRate: 19,
          taxCode: 'IVA',
          costPriceSnapshot: new Prisma.Decimal(40),
        },
        {
          productId: 'free-item',
          quantity: 3,
          resolvedUnitPrice: 0,
          discountAmount: 0.125,
          taxRate: 19,
          taxCode: 'IVA',
          costPriceSnapshot: new Prisma.Decimal(40),
        },
      ],
      agreedCustomerTotal: 123.456789,
    });
    expect(Object.keys(quote).sort()).toEqual(['agreedCustomerTotal', 'items']);
    for (const row of quote.items) {
      expect(Object.keys(row).sort()).toEqual([
        'costPriceSnapshot',
        'discountAmount',
        'productId',
        'quantity',
        'resolvedUnitPrice',
        'taxCode',
        'taxRate',
      ]);
    }
  });

  it('freezes the root, array and every owned row and rejects mutations', () => {
    const quote = buildSaleQuote([resolvedRow(), resolvedRow()], 173.5);
    expect(Object.isFrozen(quote)).toBe(true);
    expect(Object.isFrozen(quote.items)).toBe(true);
    for (const row of quote.items) expect(Object.isFrozen(row)).toBe(true);
    expect(Reflect.set(quote, 'agreedCustomerTotal', 1)).toBe(false);
    expect(Reflect.set(quote.items[0], 'resolvedUnitPrice', 1)).toBe(false);
    expect(Reflect.set(quote.items, '0', {})).toBe(false);
    expect(Reflect.set(quote.items, 'length', 0)).toBe(false);
    expect(quote.agreedCustomerTotal).toBe(173.5);
    expect(quote.items).toHaveLength(2);
    expect(quote.items[0].resolvedUnitPrice).toBe(80);
  });

  it('owns each copy while leaving caller rows and catalog writable', () => {
    const product = productFixture();
    const row = resolveSaleItemPricing(
      product,
      { quantity: 2 },
      false,
    ).pricedItem;
    const rows = [row];
    const quote = buildSaleQuote(rows, 190.4);
    const secondQuote = buildSaleQuote(rows, 190.4);
    expect(secondQuote).not.toBe(quote);
    expect(secondQuote.items).not.toBe(quote.items);
    expect(secondQuote.items[0]).not.toBe(quote.items[0]);
    expect(quote.items).not.toBe(rows);
    expect(quote.items[0]).not.toBe(row);
    expect(Object.isFrozen(rows)).toBe(false);
    expect(Object.isFrozen(row)).toBe(false);
    expect(Object.isFrozen(product)).toBe(false);
    row.unitPrice = 999;
    row.quantity = 7;
    row.discountAmount = 12;
    rows.push(resolvedRow());
    product.salePrice = new Prisma.Decimal(900);
    product.promotionValue = new Prisma.Decimal(50);
    expect(quote).toEqual({
      items: [
        {
          productId: 'product-1',
          quantity: 2,
          resolvedUnitPrice: 80,
          discountAmount: 0,
          taxRate: 19,
          taxCode: 'IVA',
          costPriceSnapshot: new Prisma.Decimal(40),
        },
      ],
      agreedCustomerTotal: 190.4,
    });
    expect(secondQuote).toEqual(quote);
  });

  it('copies an empty value without adding sale-validity policy', () => {
    const quote = buildSaleQuote([], 0);
    expect(quote).toEqual({ items: [], agreedCustomerTotal: 0 });
    expect(Object.isFrozen(quote.items)).toBe(true);
  });

  it('keeps each resolved line tax rate and cost snapshot in the built quote', () => {
    const resolved = resolveSaleItemPricing(
      productFixture(),
      { quantity: 2, discountAmount: 10 },
      false,
    ).pricedItem;
    const quote = buildSaleQuote([resolved], 178.5);
    expect(quote.agreedCustomerTotal).toBe(178.5);
    expect(quote.items[0]).toEqual(
      expect.objectContaining({
        productId: 'product-1',
        quantity: 2,
        resolvedUnitPrice: 80,
        discountAmount: 10,
        taxRate: 19,
        taxCode: 'IVA',
        costPriceSnapshot: resolved.costPriceSnapshot,
      }),
    );
    expect(Object.keys(quote.items[0]).sort()).toEqual([
      'costPriceSnapshot',
      'discountAmount',
      'productId',
      'quantity',
      'resolvedUnitPrice',
      'taxCode',
      'taxRate',
    ]);
    expect(Object.isFrozen(quote.items[0])).toBe(true);
  });

  // The code and the rate travel together, including the absence of both: an
  // untaxed line must not inherit an invented IVA code the quote cannot justify.
  it('keeps a null tax code for an untaxed line', () => {
    const product = productFixture({
      taxable: false,
      category: {
        taxable: false,
        defaultTaxRate: null,
        defaultTaxCode: null,
      },
    });
    const resolved = resolveSaleItemPricing(
      product,
      { quantity: 1, discountAmount: 0 },
      false,
    ).pricedItem;
    const quote = buildSaleQuote([resolved], 100);
    expect(quote.items[0]).toEqual(
      expect.objectContaining({ taxRate: 0, taxCode: null }),
    );
  });
});

describe('resolveSaleItemPricing contract', () => {
  it.each([
    { unitPrice: undefined, subtotal: 150, taxAmount: 28.5, total: 178.5 },
    { unitPrice: 60, subtotal: 110, taxAmount: 20.9, total: 130.9 },
  ])(
    'returns the resolved row and original tax for price $unitPrice',
    (expected) => {
      const product = productFixture();
      const result = resolveSaleItemPricing(
        product,
        { quantity: 2, discountAmount: 10, unitPrice: expected.unitPrice },
        true,
      );
      expect(result).toEqual({
        pricedItem: {
          productId: 'product-1',
          productType: 'PRODUCT',
          productTracksStock: true,
          quantity: 2,
          unitPrice: expected.unitPrice ?? 80,
          costPriceSnapshot: new Prisma.Decimal(40),
          taxRate: 19,
          taxCode: 'IVA',
          discountAmount: 10,
          subtotal: expected.subtotal,
          total: expected.total,
        },
        taxAmount: expected.taxAmount,
        override:
          expected.unitPrice === undefined
            ? undefined
            : {
                productId: 'product-1',
                productName: 'Coffee',
                quantity: 2,
                serverUnitPrice: 80,
                overriddenUnitPrice: 60,
              },
      });
      expect(result.pricedItem.costPriceSnapshot).toBe(product.costPrice);
    },
  );
});

describe('SalesService.create pricing characterization (before persistence)', () => {
  it.each(cases)(
    '$name',
    async ({ product, item, role, total, error, forbidden }) => {
      const prisma = {
        product: {
          findFirst: jest
            .fn<Promise<PricingProduct | null>, [Prisma.ProductFindFirstArgs]>()
            .mockResolvedValue(productFixture(product)),
        },
        customer: { findFirst: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
      };
      const sequence = { nextNumber: jest.fn() };
      const service = new SalesService(
        prisma as never,
        {} as never,
        {} as never,
        sequence as never,
        {} as never,
      );
      const input: CreateSaleDto = {
        items: [
          { productId: 'product-1', quantity: 2, discountAmount: 10, ...item },
        ],
        discountAmount: 5,
        payments: [{ method: 'CASH', amount: 1 }],
      };

      // Underpayment exposes the actual quote without reaching sequence/stock writes.
      const result = service.create(
        input,
        'user-1',
        'org-1',
        role ? actor(role) : undefined,
      );
      await expect(result).rejects.toBeInstanceOf(
        forbidden ? ForbiddenException : BadRequestException,
      );
      await expect(result).rejects.toThrow(
        error ?? `Total paid (1) is less than total (${total})`,
      );
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'product-1', organizationId: 'org-1' },
        include: { category: true },
      });
      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(sequence.nextNumber).not.toHaveBeenCalled();
    },
  );
});

describe('resolveSaleItemPricing tax code (T4b)', () => {
  const pricedCode = (product: Partial<PricingProduct>) =>
    resolveSaleItemPricing(
      productFixture(product),
      { quantity: 1, discountAmount: 0 },
      false,
    ).pricedItem;

  it.each([
    {
      name: 'product code travels with the product rate',
      product: { taxCode: 'INC' as const, taxRate: new Prisma.Decimal(8) },
      expected: { taxRate: 8, taxCode: 'INC' },
    },
    {
      name: 'a taxable product without a stored code resolves to IVA',
      product: {},
      expected: { taxRate: 19, taxCode: 'IVA' },
    },
    {
      name: 'category code travels with the category rate',
      product: { taxable: false },
      expected: { taxRate: 10, taxCode: 'IVA' },
    },
    {
      // The decisive case: a taxable product with a zero rate loses to the
      // category, so the category also supplies the code. Taking the product
      // code here would pair a rate of 10 with INC.
      name: 'code and rate always come from the same source',
      product: {
        taxable: true,
        taxRate: new Prisma.Decimal(0),
        taxCode: 'INC' as const,
      },
      expected: { taxRate: 10, taxCode: 'IVA' },
    },
    {
      name: 'an untaxed line carries no code at all',
      product: {
        taxable: false,
        category: {
          taxable: false,
          defaultTaxRate: null,
          defaultTaxCode: 'ICA' as const,
        },
      },
      expected: { taxRate: 0, taxCode: null },
    },
  ])('$name', ({ product, expected }) => {
    expect(pricedCode(product)).toMatchObject(expected);
  });
});

describe('toPersistedLineTax (T4b persisted invariant)', () => {
  it('persists the code next to a positive amount', () => {
    expect(toPersistedLineTax('INC', 8.5)).toEqual({
      taxCode: 'INC',
      taxAmount: 8.5,
    });
  });

  it('persists no code and no amount when the line carries no tax', () => {
    // A taxable rate on a zero-subtotal line, and an untaxed line, both end up
    // here: a code may never accompany a zero amount (T4a decision, L56).
    expect(toPersistedLineTax('IVA', 0)).toEqual({
      taxCode: null,
      taxAmount: null,
    });
    expect(toPersistedLineTax(null, 0)).toEqual({
      taxCode: null,
      taxAmount: null,
    });
  });

  it('throws rather than persisting a taxed line without a code', () => {
    expect(() => toPersistedLineTax(null, 19)).toThrow(/tax code/);
  });

  // This helper is shared with the cash sale path, whose money is derived from
  // JS floats. Its rounding is part of that behaviour and must not change: the
  // float product of 0.40499999999999997 is exactly 40.5, so the historical
  // answer is 0.41, and an exact decimal half cent still under-rounds because
  // 1.005 * 100 is 100.49999999999999. Financed cents are computed from
  // `Decimal` by `reconcileLineTaxes` instead of being re-rounded here.
  it('keeps the established rounding of a float-derived half cent', () => {
    expect(toPersistedLineTax('IVA', 0.40499999999999997)).toEqual({
      taxCode: 'IVA',
      taxAmount: 0.41,
    });
  });

  it('keeps the established rounding of an exact decimal half cent', () => {
    expect(toPersistedLineTax('IVA', 1.005)).toEqual({
      taxCode: 'IVA',
      taxAmount: 1,
    });
  });
});

describe('reconcileLineTaxes (financed sales: fixed payable, consistent lines)', () => {
  const sum = (lines: ReturnType<typeof reconcileLineTaxes>) =>
    lines
      .reduce(
        (total, line) => total.plus(line.taxAmount ?? 0),
        new Prisma.Decimal(0),
      )
      .toFixed(2);

  it('leaves every line on its own cent when the roundings already add up', () => {
    const lines = reconcileLineTaxes(
      [{ taxCode: 'IVA', taxAmount: new Prisma.Decimal('28.50') }],
      new Prisma.Decimal('28.50'),
    );
    expect(lines).toEqual([{ taxCode: 'IVA', taxAmount: 28.5 }]);
  });

  // Three lines of 33.33 at 19%: exact tax 18.9981, agreed tax 19.00, and each
  // line rounds to 6.33. The cent that per-line rounding loses is the only thing
  // standing between a valid financed sale and a 409.
  it('allocates the cent per-line rounding loses, keeping the invoice tax exact', () => {
    const exact = new Prisma.Decimal('6.3327');
    const lines = reconcileLineTaxes(
      [
        { taxCode: 'IVA', taxAmount: exact },
        { taxCode: 'IVA', taxAmount: exact },
        { taxCode: 'IVA', taxAmount: exact },
      ],
      new Prisma.Decimal('19.00'),
    );
    expect(lines).toEqual([
      { taxCode: 'IVA', taxAmount: 6.34 },
      { taxCode: 'IVA', taxAmount: 6.33 },
      { taxCode: 'IVA', taxAmount: 6.33 },
    ]);
    expect(sum(lines)).toBe('19.00');
  });

  it('never gives a cent to a line that carries no tax code', () => {
    const lines = reconcileLineTaxes(
      [
        { taxCode: 'IVA', taxAmount: new Prisma.Decimal('6.3327') },
        { taxCode: null, taxAmount: new Prisma.Decimal(0) },
      ],
      new Prisma.Decimal('6.33'),
    );
    expect(lines).toEqual([
      { taxCode: 'IVA', taxAmount: 6.33 },
      { taxCode: null, taxAmount: null },
    ]);
  });

  // Two lines of 0.03 at 19%: exact tax 0.0114, agreed tax 0.01, and each line
  // rounds to 0.01. The sale still pays 0.01, so one line takes the cent and the
  // other honestly carries none.
  // A taxed line whose exact tax rounds to zero cannot keep its code, and the
  // DIAN semantics of a zero-amount line with a positive rate are unproven
  // (L72), so the sale fails closed instead of relabelling the line as untaxed.
  it('fails closed when a taxed line would keep a rate but lose its code', () => {
    expect(() =>
      reconcileLineTaxes(
        [
          { taxCode: 'IVA', taxAmount: new Prisma.Decimal('0.0057') },
          { taxCode: 'IVA', taxAmount: new Prisma.Decimal('0.0057') },
        ],
        new Prisma.Decimal('0.01'),
      ),
    ).toThrow(ConflictException);
  });

  it('refuses to place a fractional cent on a line that has no code', () => {
    expect(() =>
      reconcileLineTaxes(
        [{ taxCode: null, taxAmount: new Prisma.Decimal('0.0057') }],
        new Prisma.Decimal('0.01'),
      ),
    ).toThrow(ConflictException);
  });

  it('fails closed when the coded lines cannot carry the invoice tax', () => {
    expect(() =>
      reconcileLineTaxes(
        [
          { taxCode: 'IVA', taxAmount: new Prisma.Decimal('0.01') },
          { taxCode: null, taxAmount: new Prisma.Decimal(0) },
        ],
        new Prisma.Decimal('0.05'),
      ),
    ).toThrow(ConflictException);
  });

  it('fails closed on an empty line list', () => {
    expect(() => reconcileLineTaxes([], new Prisma.Decimal('0.01'))).toThrow(
      ConflictException,
    );
  });

  it.each(['0.005', '-0.01'])(
    'fails closed on the invoice tax %s',
    (invoiceTax) => {
      expect(() =>
        reconcileLineTaxes(
          [{ taxCode: 'IVA', taxAmount: new Prisma.Decimal('0.01') }],
          new Prisma.Decimal(invoiceTax),
        ),
      ).toThrow(ConflictException);
    },
  );

  it('fails closed when the invoice tax is not a decimal value', () => {
    expect(() =>
      reconcileLineTaxes(
        [{ taxCode: 'IVA', taxAmount: new Prisma.Decimal('0.01') }],
        'not money' as unknown as Prisma.Decimal,
      ),
    ).toThrow(ConflictException);
  });

  it('is deterministic: the same quote always allocates the same cents', () => {
    const exact = new Prisma.Decimal('1.005');
    const input = [
      { taxCode: 'IVA' as const, taxAmount: exact },
      { taxCode: 'INC' as const, taxAmount: exact },
    ];
    const first = reconcileLineTaxes(input, new Prisma.Decimal('2.01'));
    const second = reconcileLineTaxes(input, new Prisma.Decimal('2.01'));
    expect(first).toEqual(second);
    expect(first).toEqual([
      { taxCode: 'IVA', taxAmount: 1.01 },
      { taxCode: 'INC', taxAmount: 1 },
    ]);
    expect(sum(first)).toBe('2.01');
  });
});

describe('saleMoneyReconciles (invoice identity to the cent)', () => {
  it('accepts money whose parts add up to the payable', () => {
    expect(
      saleMoneyReconciles({
        lineExtensionAmount: 100,
        taxAmount: 19,
        discountAmount: 0,
        payableAmount: 119,
      }),
    ).toBe(true);
    // Decimal and string inputs are the same money as the numbers.
    expect(
      saleMoneyReconciles({
        lineExtensionAmount: new Prisma.Decimal('2826.30'),
        taxAmount: new Prisma.Decimal('141.31'),
        discountAmount: new Prisma.Decimal('1569.23'),
        payableAmount: new Prisma.Decimal('1398.38'),
      }),
    ).toBe(true);
  });

  // A sale-wide discount with a fraction of a cent is stored as 0.01 while the
  // payable keeps its own rounding: the document would contradict itself.
  it('rejects a fractional-cent discount that breaks the identity', () => {
    expect(
      saleMoneyReconciles({
        lineExtensionAmount: 10,
        taxAmount: 0,
        discountAmount: 0.005,
        payableAmount: 10,
      }),
    ).toBe(false);
    expect(
      saleMoneyReconciles({
        lineExtensionAmount: 100,
        taxAmount: 19,
        discountAmount: 0.005,
        payableAmount: 119,
      }),
    ).toBe(false);
  });

  it('accepts the same discount once it lands on a whole cent', () => {
    expect(
      saleMoneyReconciles({
        lineExtensionAmount: 10,
        taxAmount: 0,
        discountAmount: 0.01,
        payableAmount: 9.99,
      }),
    ).toBe(true);
  });

  it('fails closed on an unreadable amount instead of answering safe', () => {
    expect(
      saleMoneyReconciles({
        lineExtensionAmount: 10,
        taxAmount: 0,
        discountAmount: 0,
        payableAmount: 'not money' as unknown as Prisma.Decimal,
      }),
    ).toBe(false);
  });
});

describe('saleLinesReconcile (invoice money equals its own lines)', () => {
  const facts = {
    lineExtensionAmount: 200,
    taxAmount: 38,
    discountAmount: 0,
    payableAmount: 238,
  };

  it('accepts lines whose persisted cents add up to the invoice facts', () => {
    expect(
      saleLinesReconcile(
        [
          { subtotal: 100, taxAmount: 19 },
          { subtotal: 100, taxAmount: 19 },
        ],
        facts,
      ),
    ).toBe(true);
  });

  it('accepts an untaxed line without a tax fact', () => {
    expect(
      saleLinesReconcile(
        [
          { subtotal: 200, taxAmount: 38 },
          { subtotal: 0, taxAmount: null },
        ],
        facts,
      ),
    ).toBe(true);
  });

  // Two lines of 99.995 are stored as 100.00 each while a header subtotal of
  // 199.99 keeps its own rounding: the totals can satisfy their own identity
  // and still describe lines that do not add up to them.
  it('rejects lines whose own rounding disagrees with the header', () => {
    expect(
      saleLinesReconcile(
        [
          { subtotal: 99.995, taxAmount: 0 },
          { subtotal: 99.995, taxAmount: 0 },
        ],
        {
          lineExtensionAmount: 199.99,
          taxAmount: 0,
          discountAmount: 0,
          payableAmount: 199.99,
        },
      ),
    ).toBe(false);
  });

  it('rejects a line tax that disagrees with the invoice tax', () => {
    expect(saleLinesReconcile([{ subtotal: 200, taxAmount: 19 }], facts)).toBe(
      false,
    );
  });

  it('fails closed on an empty or unreadable line set', () => {
    expect(saleLinesReconcile([], facts)).toBe(false);
    expect(
      saleLinesReconcile(
        [{ subtotal: 'not money' as unknown as Prisma.Decimal, taxAmount: 0 }],
        facts,
      ),
    ).toBe(false);
  });
});
