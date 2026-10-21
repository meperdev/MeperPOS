import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { buildSaleQuote } from './sale-pricing';

export type PreparedSaleQuote = Readonly<{
  snapshot: Prisma.InputJsonObject & {
    readonly items: ReadonlyArray<{
      readonly productId: string;
      readonly quantity: number;
      readonly resolvedUnitPrice: string;
      readonly discountAmount: string;
      readonly taxRate: number;
      readonly costPriceSnapshot: string;
    }>;
    readonly agreedCustomerTotal: string;
    readonly discountAmount: string;
  };
  agreedCustomerTotal: Prisma.Decimal;
}>;

type QuoteItem = ReturnType<typeof buildSaleQuote>['items'][number];

const MAX_STORED_MONEY = 99999999.99;
const MAX_STORED_QUANTITY = 2147483647;

/** Normalize server numbers only at this Decimal(10,2) persistence boundary. */
function normalizeMoney(value: number): Prisma.Decimal {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BadRequestException('Quote money must be finite and nonnegative');
  }
  const normalized = new Prisma.Decimal(value).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  if (normalized.greaterThan(MAX_STORED_MONEY)) {
    throw new BadRequestException('Quote money exceeds Decimal(10,2) storage');
  }
  return normalized;
}

/** Pure server-owned quote projection for future persistence, not sale pricing. */
export function prepareSaleQuoteForStorage(
  quote: ReturnType<typeof buildSaleQuote> & { discountAmount?: number },
): PreparedSaleQuote {
  if (!Array.isArray(quote.items) || quote.items.length === 0) {
    throw new BadRequestException('A stored quote requires at least one item');
  }
  const agreedCustomerTotal = normalizeMoney(quote.agreedCustomerTotal);
  if (!agreedCustomerTotal.greaterThan(0)) {
    throw new BadRequestException('A stored quote requires a positive total');
  }

  const items = quote.items.map((item: QuoteItem) => {
    if (typeof item.productId !== 'string' || item.productId.trim() === '') {
      throw new BadRequestException(
        'Quote product IDs must be nonblank strings',
      );
    }
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > MAX_STORED_QUANTITY
    ) {
      throw new BadRequestException(
        'Quote quantities must be positive Prisma Ints',
      );
    }
    if (
      typeof item.taxRate !== 'number' ||
      !Number.isFinite(item.taxRate) ||
      item.taxRate < 0 ||
      item.taxRate > 999.99 ||
      new Prisma.Decimal(item.taxRate).decimalPlaces() > 2
    ) {
      throw new BadRequestException('Quote tax rate must fit Decimal(5,2)');
    }
    return Object.freeze({
      productId: item.productId,
      quantity: item.quantity,
      resolvedUnitPrice: normalizeMoney(item.resolvedUnitPrice).toFixed(2),
      discountAmount: normalizeMoney(item.discountAmount).toFixed(2),
      taxRate: item.taxRate,
      costPriceSnapshot: normalizeMoney(Number(item.costPriceSnapshot)).toFixed(
        2,
      ),
    });
  });
  const snapshot = Object.freeze({
    items: Object.freeze(items),
    agreedCustomerTotal: agreedCustomerTotal.toFixed(2),
    discountAmount: normalizeMoney(quote.discountAmount ?? 0).toFixed(2),
  });
  // Freeze only owned JSON/container objects; Decimal internals remain mutable.
  return Object.freeze({ snapshot, agreedCustomerTotal });
}
