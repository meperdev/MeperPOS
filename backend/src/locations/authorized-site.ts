import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole, type Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';

/**
 * Check the exact site inside the inventory transaction, before acquiring any
 * sequence or stock locks. Keep the authorization rows locked through commit.
 * Transaction failures propagate so the caller can handle the whole operation.
 */
export async function resolveWritableSiteWithin(
  tx: Prisma.TransactionClient,
  actor: RequestUser,
  requestedLocationId: string,
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
    ? await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Location"
        WHERE "id" = ${requestedLocationId} AND "organizationId" = ${organizationId}
        FOR SHARE
      `
    : await tx.$queryRaw<{ id: string }[]>`
        SELECT site."id"
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
  return { organizationId, locationId: location.id };
}
