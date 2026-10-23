import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrgRole, type Category, type Product } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { resolveEffectiveTaxRate } from '../common/utils/tax.util';
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
> & { category: Pick<Category, 'taxable' | 'defaultTaxRate'> | null };

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
