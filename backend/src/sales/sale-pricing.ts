import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrgRole, type Category, type Product } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import {
  type DianTaxCode,
  resolveEffectiveTaxCode,
  resolveEffectiveTaxRate,
} from '../common/utils/tax.util';
import { computeEffectiveSalePrice } from '../products/products.service';
import type { SaleItemDto } from './dto/sales.dto';

export type SalePricingProduct = Pick<
  Product,
  | 'id'
  | 'name'
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
  category: Pick<
    Category,
    'taxable' | 'defaultTaxRate' | 'defaultTaxCode'
  > | null;
};

/** Shared POS permission; overrides never grant catalog editing rights. */
export function canOverrideSalePrice(user: RequestUser | undefined): boolean {
  if (!user) return false;
  if (user.isSuperAdmin || user.role === 'SUPER_ADMIN') return true;
  return (
    user.role === OrgRole.ADMIN ||
    user.role === OrgRole.OWNER ||
    user.role === OrgRole.CASHIER
  );
}

/** Server-resolved POS pricing; override permission stays with the caller. */
export function resolveSaleItemPricing(
  product: SalePricingProduct,
  item: Pick<SaleItemDto, 'quantity' | 'unitPrice' | 'discountAmount'>,
  canOverride: boolean,
) {
  const serverUnitPrice = Number(
    computeEffectiveSalePrice(product) ?? product.salePrice,
  );
  const requestedUnitPrice =
    item.unitPrice === undefined || item.unitPrice === null
      ? null
      : Number(item.unitPrice);

  // Service callers may bypass the DTO's nonnegative-price validation.
  if (requestedUnitPrice !== null && requestedUnitPrice < 0) {
    throw new BadRequestException(
      `Unit price for product ${product.name} cannot be negative`,
    );
  }

  // Preserve the existing tolerance for round-tripped DECIMAL(10,2) prices.
  const isOverride =
    requestedUnitPrice !== null &&
    Math.abs(requestedUnitPrice - serverUnitPrice) > 0.01;
  if (isOverride && !canOverride) {
    throw new ForbiddenException(
      `Only an ADMIN, OWNER, SUPER_ADMIN or CASHIER may override the unit price of ${product.name}`,
    );
  }
  const unitPrice = isOverride ? requestedUnitPrice : serverUnitPrice;
  const override = isOverride
    ? {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        serverUnitPrice,
        overriddenUnitPrice: unitPrice,
      }
    : undefined;

  const grossSubtotal = unitPrice * item.quantity;
  const itemDiscount = Math.max(0, item.discountAmount || 0);
  if (itemDiscount > grossSubtotal) {
    throw new BadRequestException(
      `Item discount for product ${product.name} cannot exceed item subtotal`,
    );
  }

  const itemSubtotal = grossSubtotal - itemDiscount;
  const effectiveTaxRate = resolveEffectiveTaxRate(product, product.category);
  // Resolved from the same product/category as the rate, by the same util, so
  // the persisted code and the persisted rate can never describe two different
  // taxes. `null` means "no tax", never "unknown tax".
  const effectiveTaxCode = resolveEffectiveTaxCode(product, product.category);
  const itemTax = itemSubtotal * (effectiveTaxRate / 100);
  const itemTotal = itemSubtotal + itemTax;
  return {
    pricedItem: {
      productId: product.id,
      productType: product.type,
      productTracksStock: product.tracksStock,
      quantity: item.quantity,
      unitPrice,
      costPriceSnapshot: product.costPrice,
      taxRate: effectiveTaxRate,
      taxCode: effectiveTaxCode,
      discountAmount: itemDiscount,
      subtotal: itemSubtotal,
      total: itemTotal,
    },
    // Return the original tax, not total minus subtotal (float cancellation).
    taxAmount: itemTax,
    override,
  };
}

export type PricedSaleItem = ReturnType<
  typeof resolveSaleItemPricing
>['pricedItem'];

/** The per-line fiscal facts `SaleItem` stores, and nothing else. */
export interface PersistedLineTax {
  taxCode: DianTaxCode | null;
  taxAmount: number | null;
}

/**
 * The only place where a line becomes persisted fiscal facts.
 *
 * Invariant: a persisted `taxCode` iff the persisted `taxAmount` is greater than
 * zero. It is enforced here, once, so no caller can persist a code that no tax
 * justifies or a tax that carries no code:
 *
 *   - no tax (an untaxed line, or a taxed rate on a zero-subtotal line) → both
 *     NULL, because a code may never accompany a zero amount (T4a decision);
 *   - tax without a resolved code → throw, since guessing IVA is exactly the
 *     defect T4b removes;
 *   - tax with a code → both persisted.
 *
 * The amount is rounded to cents first, because that is what `DECIMAL(10,2)`
 * stores; deciding on the unrounded value could persist a code next to a 0.00
 * amount for a sub-cent tax.
 */
export function toPersistedLineTax(
  taxCode: DianTaxCode | null,
  taxAmount: number,
): PersistedLineTax {
  if (!Number.isFinite(taxAmount)) {
    throw new Error(
      `Invalid line tax amount: expected a finite number, received ${taxAmount}`,
    );
  }
  const persistedAmount = Math.round(taxAmount * 100) / 100;
  if (persistedAmount <= 0) {
    return { taxCode: null, taxAmount: null };
  }
  if (taxCode === null) {
    throw new Error(
      'Cannot persist a taxed sale line without a tax code: resolved a positive tax amount but no DIAN tax code',
    );
  }
  return { taxCode, taxAmount: persistedAmount };
}

/** In-memory value only: copies server-resolved prices, without sale activation. */
export function buildSaleQuote(
  rows: ReadonlyArray<
    Pick<
      PricedSaleItem,
      | 'productId'
      | 'quantity'
      | 'unitPrice'
      | 'discountAmount'
      | 'taxRate'
      | 'costPriceSnapshot'
    >
  >,
  agreedCustomerTotal: number,
) {
  const items = rows.map((row) =>
    Object.freeze({
      productId: row.productId,
      quantity: row.quantity,
      resolvedUnitPrice: row.unitPrice,
      discountAmount: row.discountAmount,
      taxRate: row.taxRate,
      costPriceSnapshot: row.costPriceSnapshot,
    }),
  );
  return Object.freeze({ items: Object.freeze(items), agreedCustomerTotal });
}
