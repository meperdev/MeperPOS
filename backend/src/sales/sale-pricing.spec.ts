import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Category, Prisma, Product, PromotionType } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateSaleDto, SaleItemDto } from './dto/sales.dto';
import { SalesService } from './sales.service';
import { buildSaleQuote, resolveSaleItemPricing } from './sale-pricing';

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
> & { category: Pick<Category, 'taxable' | 'defaultTaxRate'> };

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
  category: { taxable: true, defaultTaxRate: new Prisma.Decimal(10) },
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
          costPriceSnapshot: new Prisma.Decimal(40),
        },
        {
          productId: 'free-item',
          quantity: 3,
          resolvedUnitPrice: 0,
          discountAmount: 0.125,
          taxRate: 19,
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
        costPriceSnapshot: resolved.costPriceSnapshot,
      }),
    );
    expect(Object.keys(quote.items[0]).sort()).toEqual([
      'costPriceSnapshot',
      'discountAmount',
      'productId',
      'quantity',
      'resolvedUnitPrice',
      'taxRate',
    ]);
    expect(Object.isFrozen(quote.items[0])).toBe(true);
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
