import { Prisma, ProductType } from '@prisma/client';

/**
 * The low-stock rule as a database filter, in one place.
 *
 * The rule itself has a single authority (`isLowStock` in `product-type.logic`)
 * for rows already in memory. The feed, the tenant sweep and the per-organization
 * scan need the same rule evaluated in PostgreSQL, so they share this builder
 * instead of transcribing `active`, `type`, `tracksStock` and `stock <= minStock`
 * three times.
 */
export type MinStockField = Prisma.FieldRef<'Product', 'Int'>;

/** One organization's low-stock products. */
export function lowStockProductWhere(
  organizationId: string,
  minStock: MinStockField,
): Prisma.ProductWhereInput {
  return {
    organizationId,
    active: true,
    type: ProductType.PRODUCT,
    tracksStock: true,
    stock: { lte: minStock },
  } as Prisma.ProductWhereInput;
}

/** Every organization's low-stock products, used only to list tenants to scan. */
export function lowStockSweepWhere(
  minStock: MinStockField,
): Prisma.ProductWhereInput {
  return {
    active: true,
    type: ProductType.PRODUCT,
    tracksStock: true,
    stock: { lte: minStock },
  } as Prisma.ProductWhereInput;
}
