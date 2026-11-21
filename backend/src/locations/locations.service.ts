import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

const siteFields = { id: true, name: true, isDefault: true } as const;

const hasOrgWideAccess = (role: RequestUser['role']) =>
  role === OrgRole.OWNER || role === OrgRole.ADMIN || role === 'SUPER_ADMIN';

/** PostgreSQL codes that mean another transaction won the same race. */
const SERIALIZATION_PG_CODES = ['40001', '40P01'];

/**
 * `SELECT ... FOR SHARE` runs through `$queryRaw`, and Prisma reports a
 * PostgreSQL serialization failure or deadlock there as `P2010` with the
 * database code in `meta` instead of `P2034`. Map both shapes to the same
 * conflict; never retry a grant replacement on the caller's behalf.
 */
function isConcurrentAssignmentConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (['P2002', 'P2003', 'P2034'].includes(error.code)) return true;
  if (error.code !== 'P2010') return false;
  const databaseCode = (error.meta as { code?: unknown } | undefined)?.code;
  if (
    typeof databaseCode === 'string' &&
    SERIALIZATION_PG_CODES.includes(databaseCode)
  ) {
    return true;
  }
  return SERIALIZATION_PG_CODES.some((code) =>
    error.message.includes(`Code: \`${code}\``),
  );
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: RequestUser) {
    return this.prisma.location.findMany({
      where: this.accessibleTo(user),
      select: siteFields,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  async findAccessible(user: RequestUser, id: string) {
    const location = await this.prisma.location.findFirst({
      where: { ...this.accessibleTo(user), id },
      select: siteFields,
    });
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async replaceAssignments(
    actor: RequestUser,
    userId: string,
    locationIds: string[],
  ) {
    if (!hasOrgWideAccess(actor.role)) {
      throw new ForbiddenException(
        'Only organization administrators can assign locations',
      );
    }
    const organizationId = this.requireOrganization(actor);
    const membershipKey = { userId, organizationId };

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Lock the target membership and its user inside this transaction.
          // A promotion in another READ COMMITTED transaction must wait here
          // instead of landing between this check and the grant delete.
          const [membership] = await tx.$queryRaw<
            { role: OrgRole; isSuperAdmin: boolean }[]
          >`
            SELECT membership."role", target."isSuperAdmin"
            FROM "OrganizationUser" AS membership
            JOIN "User" AS target ON target."id" = membership."userId"
            WHERE membership."userId" = ${userId}
              AND membership."organizationId" = ${organizationId}
            FOR SHARE OF membership, target
          `;
          if (!membership) throw new NotFoundException('Membership not found');
          if (hasOrgWideAccess(membership.role) || membership.isSuperAdmin) {
            throw new ConflictException(
              'Membership already has organization-wide location access',
            );
          }

          const count = await tx.location.count({
            where: { id: { in: locationIds }, organizationId },
          });
          if (count !== locationIds.length) {
            throw new NotFoundException('Location not found');
          }

          await tx.membershipLocation.deleteMany({ where: membershipKey });
          if (locationIds.length) {
            await tx.membershipLocation.createMany({
              data: locationIds.map((locationId) => ({
                ...membershipKey,
                locationId,
              })),
            });
          }
          return { locationIds };
        },
        // Concurrent replacements must not accidentally combine their grants.
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isConcurrentAssignmentConflict(error)) {
        throw new ConflictException(
          'Location assignments changed concurrently',
        );
      }
      throw error;
    }
  }

  private accessibleTo(user: RequestUser): Prisma.LocationWhereInput {
    const organizationId = this.requireOrganization(user);
    return hasOrgWideAccess(user.role)
      ? { organizationId }
      : {
          organizationId,
          assignments: { some: { userId: user.userId, organizationId } },
        };
  }

  private requireOrganization(user: RequestUser): string {
    if (!user.organizationId) {
      throw new ForbiddenException('Organization scope required');
    }
    return user.organizationId;
  }
}
