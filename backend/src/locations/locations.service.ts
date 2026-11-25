import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LocationType, OrgRole, Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

const siteFields = {
  id: true,
  name: true,
  type: true,
  isDefault: true,
} as const;

const DUPLICATE_NAME = 'A location with this name already exists';

export interface CreateLocationInput {
  name: string;
  type?: LocationType;
}

export interface UpdateLocationInput {
  name?: string;
  type?: LocationType;
}

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

/**
 * A site create or rename can only hit one unique constraint: the
 * case-insensitive `(organizationId, name)` index. `isDefault` is never written
 * by these statements, so the partial principal-site index cannot be involved.
 */
function isDuplicateSiteName(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
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

  async posContext(user: RequestUser) {
    const organizationId = this.requireOrganization(user);
    const accessible = this.accessibleTo(user);

    return this.prisma.$transaction(
      async (tx) => {
        const topology = await tx.location.findMany({
          where: { organizationId },
          select: { id: true, isDefault: true },
          take: 2,
        });
        const locations = await tx.location.findMany({
          where: accessible,
          select: siteFields,
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { id: 'asc' }],
        });
        const sole = topology.length === 1 ? topology[0] : undefined;
        const checkoutLocationId =
          sole?.isDefault && locations.some(({ id }) => id === sole.id)
            ? sole.id
            : null;
        return { locations, checkoutLocationId };
      },
      // Permissions and topology must come from one snapshot. A restricted
      // list containing just one site is not evidence of a single-site org.
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async findAccessible(user: RequestUser, id: string) {
    const location = await this.prisma.location.findFirst({
      where: { ...this.accessibleTo(user), id },
      select: siteFields,
    });
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  /**
   * Creates a store or warehouse in the caller's organization.
   *
   * S3: this never writes a `MembershipLocation` grant. A new site starts
   * visible to owners and administrators only (they derive access from their
   * organization role); every restricted membership keeps exactly the sites an
   * administrator assigned it.
   */
  async create(actor: RequestUser, input: CreateLocationInput) {
    const organizationId = this.requireAdmin(actor);
    try {
      return await this.prisma.location.create({
        data: {
          organizationId,
          name: input.name,
          type: input.type ?? LocationType.STORE,
          // A created site is never the principal site: that one is owned by
          // provisioning and keeps the organization's default topology.
          isDefault: false,
        },
        select: siteFields,
      });
    } catch (error) {
      if (isDuplicateSiteName(error)) {
        throw new ConflictException(DUPLICATE_NAME);
      }
      throw error;
    }
  }

  /** Renames a site and/or changes its type, always inside the active tenant. */
  async update(actor: RequestUser, id: string, input: UpdateLocationInput) {
    const organizationId = this.requireAdmin(actor);
    const current = await this.prisma.location.findFirst({
      where: { id, organizationId },
      select: siteFields,
    });
    if (!current) throw new NotFoundException('Location not found');

    // The principal site hosts POS checkout, so it must stay a store.
    if (current.isDefault && input.type === LocationType.WAREHOUSE) {
      throw new BadRequestException(
        'The principal site cannot become a warehouse',
      );
    }
    if (input.name === undefined && input.type === undefined) return current;

    try {
      return await this.prisma.location.update({
        where: { id_organizationId: { id, organizationId } },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.type === undefined ? {} : { type: input.type }),
        },
        select: siteFields,
      });
    } catch (error) {
      if (isDuplicateSiteName(error)) {
        throw new ConflictException(DUPLICATE_NAME);
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        // Deleted between the scoped read and the write.
        throw new NotFoundException('Location not found');
      }
      throw error;
    }
  }

  /**
   * Reads the access of one membership in the active organization: the explicit
   * assignment rows `replaceAssignments` owns, plus whether the role itself
   * already reaches every site. An organization-wide membership holds no rows —
   * its access comes from the role, never from an empty assignment set.
   */
  async findAssignments(actor: RequestUser, userId: string) {
    const organizationId = this.requireAdmin(actor);
    const membership = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true, user: { select: { isSuperAdmin: true } } },
    });
    if (!membership) throw new NotFoundException('Membership not found');

    const grants = await this.prisma.membershipLocation.findMany({
      where: { userId, organizationId },
      select: { locationId: true },
      orderBy: [{ locationId: 'asc' }],
    });
    return {
      locationIds: grants.map(({ locationId }) => locationId),
      orgWideAccess:
        hasOrgWideAccess(membership.role) || membership.user.isSuperAdmin,
    };
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

  private requireAdmin(user: RequestUser): string {
    if (!hasOrgWideAccess(user.role)) {
      throw new ForbiddenException(
        'Only organization administrators can manage locations',
      );
    }
    return this.requireOrganization(user);
  }

  private requireOrganization(user: RequestUser): string {
    if (!user.organizationId) {
      throw new ForbiddenException('Organization scope required');
    }
    return user.organizationId;
  }
}
