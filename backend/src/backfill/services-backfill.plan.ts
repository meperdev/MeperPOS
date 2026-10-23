import { Prisma, ProductType } from '@prisma/client';

/** Live conversion CAS: reservations cannot be erased by a stock-zero write. */
export function buildServiceConversionStockGuard(
  productId: string,
  organizationId: string,
  live: { stock: number; version: number; reservedStock: number },
) {
  if (live.reservedStock !== 0) {
    throw new Error(
      `Producto ${productId} tiene reservas o un contador inválido; no se escribió nada.`,
    );
  }
  return {
    id: productId,
    organizationId,
    stock: live.stock,
    version: live.version,
    reservedStock: 0,
  } satisfies Prisma.ProductWhereInput;
}

/**
 * Pure planner for the services backfill (work unit 7).
 *
 * It is intentionally pure: no Prisma client, no I/O, no logging and no side
 * effects. The decision of WHAT has to change is taken here, in one testable
 * place, and the CLI only executes the plan it is handed. That keeps the
 * production write reviewable against a pinned contract
 * (`services-backfill.plan.spec.ts`) instead of against a live database.
 */

/** A confirmed product to correct: name + sku, both trimmed before comparing. */
export interface ServiceTarget {
  name: string;
  sku: string;
}

/** The product columns the planner needs, as loaded from the database. */
export interface BackfillProduct {
  id: string;
  name: string;
  sku: string;
  stock: number;
  type: ProductType;
  active: boolean;
}

export type BackfillRefusalReason = 'NOT_FOUND' | 'AMBIGUOUS';

/** A target that could not be resolved to exactly one row. */
export interface BackfillRefusal {
  target: ServiceTarget;
  reason: BackfillRefusalReason;
  matches: number;
}

/** A resolved correction: zero the stock and keep the kárdex consistent. */
export interface BackfillAction {
  productId: string;
  name: string;
  sku: string;
  previousStock: number;
  nextStock: number;
  movementQuantity: number;
  alreadyService: boolean;
  requiresWrite: boolean;
  requiresMovement: boolean;
}

export interface BackfillPlan {
  actions: BackfillAction[];
  refusals: BackfillRefusal[];
  canApply: boolean;
}

/**
 * Resolves every target against the loaded rows.
 *
 * A target matches a row only when BOTH the trimmed name AND the trimmed sku
 * are equal. The `active` flag is deliberately ignored: a deactivated service
 * that still holds stock keeps the data incoherent either way.
 *
 * Fails closed: one refusal is enough to make `canApply` false, because a
 * partial backfill is worse than no backfill.
 */
export function planServicesBackfill(
  targets: readonly ServiceTarget[],
  rows: readonly BackfillProduct[],
): BackfillPlan {
  const actions: BackfillAction[] = [];
  const refusals: BackfillRefusal[] = [];

  for (const target of targets) {
    const name = target.name.trim();
    const sku = target.sku.trim();

    const matches = rows.filter(
      (row) => row.name.trim() === name && row.sku.trim() === sku,
    );

    if (matches.length === 0) {
      refusals.push({ target, reason: 'NOT_FOUND', matches: 0 });
      continue;
    }

    if (matches.length > 1) {
      refusals.push({
        target,
        reason: 'AMBIGUOUS',
        matches: matches.length,
      });
      continue;
    }

    const row = matches[0];
    const previousStock = row.stock;
    const alreadyService = row.type === ProductType.SERVICE;
    // Stock left on a service is the incoherence being corrected, so any
    // non-zero stock needs its own ADJUSTMENT_OUT movement.
    const requiresMovement = previousStock !== 0;

    actions.push({
      productId: row.id,
      name: row.name.trim(),
      sku: row.sku.trim(),
      previousStock,
      nextStock: 0,
      // `-previousStock` would yield JavaScript's `-0` for a zeroed stock, and
      // `-0` is not `0` for deep equality. Normalise it so a no-stock action
      // reads as a plain zero movement.
      movementQuantity: previousStock === 0 ? 0 : -previousStock,
      alreadyService,
      // Already a service with no stock means a previous run finished the job.
      requiresWrite: !alreadyService || requiresMovement,
      requiresMovement,
    });
  }

  return {
    actions,
    refusals,
    canApply: refusals.length === 0,
  };
}
