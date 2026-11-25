import { Prisma } from '@prisma/client';

/**
 * Per-site stock ledger (T3a).
 *
 * `ProductStock` holds one row per (product, location) and is on its way to
 * being the source of truth. A `Product` row keeps the organization-wide
 * aggregate that every current reader already uses, and the database triggers
 * installed by `20261125120000_product_stock_authority` keep
 * `Product.stock`/`reservedStock` equal to the sum of their site rows. Nothing
 * here touches `Product` directly: a site write moves the aggregate through
 * those triggers.
 *
 * Callers are expected to:
 *
 *  1. authorize the site inside the same transaction (`resolveWritableSiteWithin`
 *     for an explicit site, `resolveDefaultSiteWithin` for the organization
 *     default) before writing;
 *  2. keep their own error for `{ applied: false }`, typically their existing
 *     "Insufficient stock" rejection. The helper carries no user-facing copy.
 *
 * Every statement is scoped by `organizationId`, and the composite foreign keys
 * reject a product or a location from another tenant.
 */

/** A caller contract violation: no default site, or a non-integer quantity. */
export class SiteStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteStockError';
  }
}

export interface SiteStockDelta {
  organizationId: string;
  productId: string;
  locationId: string;
  /** Signed change of the site balance. Decrements are conditional. */
  stockDelta: number;
  /** Signed change of the reservations held at the site. */
  reservedDelta: number;
  /**
   * Minimum available quantity (`stock - reservedStock`) the row must keep after
   * a change that reduces availability. Ignored by changes that raise it, so a
   * receipt still applies to a legacy site row that is negative.
   */
  requireAvailable?: number;
}

export type SiteStockResult =
  | { applied: true; created: boolean }
  | { applied: false; reason: 'insufficient-stock' };

/** Reads the organization default site inside the caller's transaction. */
export async function resolveDefaultSiteWithin(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  if (!organizationId) {
    throw new SiteStockError('A site stock operation needs an organization');
  }

  const site = await tx.location.findFirst({
    where: { organizationId, isDefault: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (!site) {
    throw new SiteStockError(
      `Organization ${organizationId} has no default location`,
    );
  }

  return site.id;
}

/**
 * Applies a signed delta to one site row.
 *
 * A change that reduces availability is a compare-and-swap: the row is only
 * updated when it keeps `reservedStock` non-negative and at least
 * `requireAvailable` available, so an over-draw is refused instead of being
 * written or surfacing as a constraint violation. A positive delta on a site
 * that never carried the product opens the row (`ON CONFLICT DO NOTHING` on the
 * primary key), and a concurrent creator is handled by re-applying the
 * conditional delta instead of duplicating the row.
 */
export async function applySiteStockDelta(
  tx: Prisma.TransactionClient,
  delta: SiteStockDelta,
): Promise<SiteStockResult> {
  const { organizationId, productId, locationId, stockDelta, reservedDelta } =
    delta;

  if (!organizationId || !productId || !locationId) {
    throw new SiteStockError(
      'A site stock delta needs an organization, a product and a location',
    );
  }
  assertInteger('stockDelta', stockDelta);
  assertInteger('reservedDelta', reservedDelta);
  if (delta.requireAvailable !== undefined) {
    assertInteger('requireAvailable', delta.requireAvailable);
    if (delta.requireAvailable < 0) {
      throw new SiteStockError('requireAvailable cannot be negative');
    }
  }

  // A no-op cannot create a row and has nothing to compare.
  if (stockDelta === 0 && reservedDelta === 0) {
    return { applied: true, created: false };
  }

  const conditional = conditionalDelta(delta);
  if ((await tx.$executeRaw(conditional)) === 1) {
    return { applied: true, created: false };
  }

  const existing = await tx.productStock.findFirst({
    where: { productId, locationId, organizationId },
    select: { organizationId: true },
  });
  if (existing) {
    return { applied: false, reason: 'insufficient-stock' };
  }

  // Opening a site row needs a delta that leaves a valid row: stock it does not
  // have cannot be taken, and reservations cannot exceed the new stock.
  if (stockDelta < 0 || reservedDelta < 0 || reservedDelta > stockDelta) {
    return { applied: false, reason: 'insufficient-stock' };
  }

  if ((await tx.$executeRaw(insertion(delta))) === 1) {
    return { applied: true, created: true };
  }

  // Another writer opened the row first; the insert did nothing, so apply the
  // delta against the values it committed.
  if ((await tx.$executeRaw(conditional)) === 1) {
    return { applied: true, created: false };
  }

  return { applied: false, reason: 'insufficient-stock' };
}

function assertInteger(label: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new SiteStockError(`${label} must be an integer, received ${value}`);
  }
}

function conditionalDelta(delta: SiteStockDelta): Prisma.Sql {
  const { organizationId, productId, locationId, stockDelta, reservedDelta } =
    delta;
  const minimumAvailable = delta.requireAvailable ?? 0;
  // Only a change that can break "reserved <= stock" is conditional; receipts
  // and releases must still apply to a legacy row that is negative.
  const reducesAvailability = stockDelta - reservedDelta < 0;
  const availabilityGuard = reducesAvailability
    ? Prisma.sql`AND ("stock" + ${stockDelta}) - ("reservedStock" + ${reservedDelta}) >= ${minimumAvailable}`
    : Prisma.empty;

  return Prisma.sql`
    UPDATE "ProductStock"
    SET "stock" = "stock" + ${stockDelta},
        "reservedStock" = "reservedStock" + ${reservedDelta}
    WHERE "productId" = ${productId}
      AND "locationId" = ${locationId}
      AND "organizationId" = ${organizationId}
      AND ("reservedStock" + ${reservedDelta}) >= 0
      ${availabilityGuard}
  `;
}

function insertion(delta: SiteStockDelta): Prisma.Sql {
  const { organizationId, productId, locationId, stockDelta, reservedDelta } =
    delta;

  return Prisma.sql`
    INSERT INTO "ProductStock" ("productId", "locationId", "organizationId", "stock", "reservedStock")
    VALUES (${productId}, ${locationId}, ${organizationId}, ${stockDelta}, ${reservedDelta})
    ON CONFLICT ("productId", "locationId") DO NOTHING
  `;
}
