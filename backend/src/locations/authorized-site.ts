import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LocationType, OrgRole, type Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';

/** User-facing refusal when a caller needs a store and named a warehouse. */
export const WAREHOUSE_IS_NOT_A_STORE =
  'La sede seleccionada es una bodega: solo una sucursal puede ser el origen de una venta o una financiación';

export interface WritableSiteOptions {
  /**
   * POS money paths only: a sale or a financing originates at a store, because
   * a warehouse has no till. Receipts, transfers and inventory edits accept
   * either type. The rule is checked on the same locked read that authorizes
   * the site, so it cannot race a type change.
   */
  requireStore?: boolean;
}

/**
 * Check the exact site inside the inventory transaction, before acquiring any
 * sequence or stock locks. Keep the authorization rows locked through commit.
 * Transaction failures propagate so the caller can handle the whole operation.
 */
export async function resolveWritableSiteWithin(
  tx: Prisma.TransactionClient,
  actor: RequestUser,
  requestedLocationId: string,
  options: WritableSiteOptions = {},
): Promise<{ organizationId: string; locationId: string }> {
  const { organizationId, userId } = actor;
  if (!organizationId) {
    throw new ForbiddenException('Organization scope required');
  }

  // Lock the parent before its children to order against organization deletion.
  const [organization] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Organization" WHERE "id" = ${organizationId}
    FOR KEY SHARE
  `;
  if (!organization) throw new NotFoundException('Location not found');

  const [user] = await tx.$queryRaw<
    { active: boolean; tokenVersion: number; isSuperAdmin: boolean }[]
  >`
    SELECT "active", "tokenVersion", "isSuperAdmin"
    FROM "User" WHERE "id" = ${userId}
    FOR SHARE
  `;
  const platform = actor.role === 'SUPER_ADMIN';
  if (
    !user?.active ||
    user.tokenVersion !== actor.tokenVersion ||
    user.isSuperAdmin !== platform ||
    actor.isSuperAdmin !== platform
  ) {
    throw new ForbiddenException('Location authorization changed');
  }

  if (!platform) {
    const [membership] = await tx.$queryRaw<{ role: OrgRole }[]>`
      SELECT "role" FROM "OrganizationUser"
      WHERE "userId" = ${userId} AND "organizationId" = ${organizationId}
      FOR SHARE
    `;
    // The route was checked with the session role. Require a fresh request if
    // that role changed, even if the new role could access the same location.
    if (membership?.role !== actor.role) {
      throw new ForbiddenException('Location authorization changed');
    }
  }

  const hasOrgWideAccess =
    platform || actor.role === OrgRole.OWNER || actor.role === OrgRole.ADMIN;
  const [location] = hasOrgWideAccess
    ? await tx.$queryRaw<{ id: string; type: LocationType }[]>`
        SELECT "id", "type" FROM "Location"
        WHERE "id" = ${requestedLocationId} AND "organizationId" = ${organizationId}
        FOR SHARE
      `
    : await tx.$queryRaw<{ id: string; type: LocationType }[]>`
        SELECT site."id", site."type"
        FROM "Location" AS site
        JOIN "MembershipLocation" AS assignment
          ON assignment."locationId" = site."id"
          AND assignment."organizationId" = site."organizationId"
        WHERE site."id" = ${requestedLocationId}
          AND site."organizationId" = ${organizationId}
          AND assignment."userId" = ${userId}
        FOR SHARE OF site, assignment
      `;
  if (!location) throw new NotFoundException('Location not found');
  if (options.requireStore && location.type !== LocationType.STORE) {
    throw new BadRequestException(WAREHOUSE_IS_NOT_A_STORE);
  }
  return { organizationId, locationId: location.id };
}
