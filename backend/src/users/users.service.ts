import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { BCRYPT_ROUNDS } from '../common/constants/security.constants';
import { OrgRole } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { PlanLimitService } from '../plan-limits/plan-limits.service';
import { AuthService } from '../auth/auth.service';

type ActorContext = {
  userId: string;
  role: OrgRole | 'SUPER_ADMIN';
  isSuperAdmin: boolean;
};

type AuditContext = {
  resource?: string;
  resourceId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

const userAdminSelect = {
  id: true,
  email: true,
  name: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

function attachAuditContext<T extends object>(
  value: T,
  context: AuditContext,
): T {
  Object.defineProperty(value, '__auditContext', {
    value: context,
    enumerable: false,
    configurable: true,
  });

  return value;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimitService: PlanLimitService,
    private readonly authService: AuthService,
  ) {}

  async create(
    createUserDto: CreateUserDto,
    organizationId?: string,
    actor?: ActorContext,
  ) {
    const { email, password, name, role } = createUserDto;

    // SEC-001, restated for phase 2 (S8 b): OWNER is retired. ADMIN is the top
    // organization role, so minting one is reserved for the organization's
    // primary owner (isPrimaryOwner) or a SUPER_ADMIN — otherwise any ADMIN
    // could fabricate an equal account and control its password.
    if (role === OrgRole.OWNER) {
      throw new ForbiddenException(
        'The OWNER role is retired. Assign ADMIN instead.',
      );
    }

    if (
      role === OrgRole.ADMIN &&
      !(await this.isPrimaryOwnerActor(actor, organizationId))
    ) {
      throw new ForbiddenException(
        'Only the primary owner of the organization or a SUPER_ADMIN can create ADMIN users',
      );
    }

    await this.ensureEmailAvailable(email);

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const createdUser = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        ...(organizationId
          ? {
              organizationUsers: {
                create: {
                  organizationId,
                  role: role ?? OrgRole.CASHIER,
                },
              },
            }
          : {}),
      },
      select: userAdminSelect,
    });

    if (organizationId) {
      this.planLimitService.invalidateCache('users', organizationId);
    }

    return attachAuditContext(createdUser, {
      resource: 'User',
      resourceId: createdUser.id,
      summary: `Created user ${createdUser.name} (${createdUser.email})`,
      metadata: {
        targetUserEmail: createdUser.email,
        targetUserName: createdUser.name,
        active: createdUser.active,
        organizationId: organizationId ?? null,
        role: role ?? OrgRole.CASHIER,
      },
    });
  }

  async findAll(organizationId?: string) {
    if (!organizationId) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        organizationUsers: {
          some: { organizationId },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: userAdminSelect,
    });
  }

  async update(
    adminUserId: string,
    userId: string,
    updateUserDto: UpdateUserDto,
    organizationId?: string,
  ) {
    const previousUser = await this.findUserOrThrow(userId, organizationId);
    await this.assertSingleOrgTarget(userId);

    if (updateUserDto.email) {
      await this.ensureEmailAvailable(updateUserDto.email, userId);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(updateUserDto.name !== undefined
          ? { name: updateUserDto.name }
          : {}),
        ...(updateUserDto.email !== undefined
          ? { email: updateUserDto.email }
          : {}),
      },
      select: userAdminSelect,
    });

    const changedFields: string[] = [];
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (
      updateUserDto.name !== undefined &&
      previousUser.name !== updatedUser.name
    ) {
      changedFields.push('name');
      changes.name = { from: previousUser.name, to: updatedUser.name };
    }

    if (
      updateUserDto.email !== undefined &&
      previousUser.email !== updatedUser.email
    ) {
      changedFields.push('email');
      changes.email = { from: previousUser.email, to: updatedUser.email };
    }

    const summary =
      changedFields.length > 0
        ? `Updated user ${updatedUser.name} (${updatedUser.email}): ${changedFields.join(', ')}`
        : `Update requested for user ${updatedUser.name} (${updatedUser.email}) without effective field changes`;

    return attachAuditContext(updatedUser, {
      resource: 'User',
      resourceId: updatedUser.id,
      summary,
      metadata: {
        targetUserEmail: updatedUser.email,
        targetUserName: updatedUser.name,
        changedFields,
        changes,
      },
    });
  }

  async toggleActive(
    adminUserId: string,
    userId: string,
    organizationId?: string,
  ) {
    if (adminUserId === userId) {
      throw new BadRequestException(
        'Admins cannot deactivate their own account',
      );
    }

    const user = await this.findUserOrThrow(userId, organizationId);
    await this.assertSingleOrgTarget(userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { active: !user.active },
      select: userAdminSelect,
    });

    return attachAuditContext(updatedUser, {
      resource: 'User',
      resourceId: updatedUser.id,
      summary: `${updatedUser.active ? 'Reactivated' : 'Deactivated'} user ${updatedUser.name} (${updatedUser.email})`,
      metadata: {
        targetUserEmail: updatedUser.email,
        targetUserName: updatedUser.name,
        previousActive: user.active,
        nextActive: updatedUser.active,
      },
    });
  }

  async resetPassword(
    adminUserId: string,
    userId: string,
    dto: ResetUserPasswordDto,
    organizationId: string,
    actor?: ActorContext,
  ) {
    const targetUser = await this.findUserOrThrow(userId, organizationId);
    await this.assertSingleOrgTarget(userId);

    // SEC-001, restated for phase 2 (S8 c): the account to protect is the
    // primary owner's (isPrimaryOwner), not a role, because nobody is OWNER any
    // more. Only the primary owner or a SUPER_ADMIN may reset that password,
    // which keeps the migration from opening the owner's account to every ADMIN.
    if (!(await this.isPrimaryOwnerActor(actor, organizationId))) {
      const targetOrgUser = await this.prisma.organizationUser.findFirst({
        where: { userId, organizationId },
        select: { isPrimaryOwner: true },
      });
      if (targetOrgUser?.isPrimaryOwner === true) {
        throw new ForbiddenException(
          'Only the primary owner can reset the primary owner password. Ask the primary owner (or support) to do it.',
        );
      }
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Credential hygiene: the reset invalidates the target's active sessions
    // (tokenVersion bump + refresh-token revocation). Revocation is global,
    // which is exactly why it only runs behind the single-org rule above.
    await this.authService.revokeUserTokens(userId);

    // The audit row is written by AuditInterceptor (wired on the
    // reset-password route) from the attached context, reproducing the
    // pre-migration manual auditLog.create contract exactly.
    return attachAuditContext(
      { message: 'Contraseña restablecida exitosamente' },
      {
        resource: 'User',
        resourceId: userId,
        summary: `Reset password for user ${targetUser.name} (${targetUser.email})`,
        metadata: {
          targetUserId: userId,
          targetUserEmail: targetUser.email,
          targetUserName: targetUser.name,
        },
      },
    );
  }

  async remove(adminUserId: string, userId: string, organizationId?: string) {
    if (adminUserId === userId) {
      throw new BadRequestException('Admins cannot delete their own account');
    }

    const user = await this.findUserOrThrow(userId, organizationId);

    let deletedGlobalUser = false;

    if (organizationId) {
      const orgUser = await this.prisma.organizationUser.findFirst({
        where: { userId, organizationId },
      });

      if (!orgUser) {
        throw new ForbiddenException(
          'User does not belong to this organization',
        );
      }

      if (orgUser.isPrimaryOwner) {
        throw new BadRequestException(
          'Cannot remove the primary owner. Transfer ownership first.',
        );
      }

      if (orgUser.role === OrgRole.ADMIN) {
        const adminCount = await this.prisma.organizationUser.count({
          where: {
            organizationId,
            role: OrgRole.ADMIN,
          },
        });

        if (adminCount <= 1) {
          throw new BadRequestException(
            'Cannot remove the last admin of an organization',
          );
        }
      }

      // Organization-scoped removal: only the membership in the caller's
      // organization is deleted so other organizations sharing this user
      // keep their account intact.
      await this.prisma.organizationUser.delete({
        where: { id: orgUser.id },
      });

      const remainingMemberships = await this.prisma.organizationUser.count({
        where: { userId },
      });

      deletedGlobalUser = remainingMemberships === 0;
    }

    if (deletedGlobalUser || !organizationId) {
      await this.prisma.user.delete({
        where: { id: userId },
      });
    }

    return attachAuditContext(
      {
        message:
          deletedGlobalUser || !organizationId
            ? 'User deleted successfully'
            : 'User removed from organization',
      },
      {
        resource: 'User',
        resourceId: userId,
        summary:
          deletedGlobalUser || !organizationId
            ? `Deleted user ${user.name} (${user.email})`
            : `Removed user ${user.name} (${user.email}) from organization`,
        metadata: {
          targetUserEmail: user.email,
          targetUserName: user.name,
          active: user.active,
          ...(organizationId ? { organizationId } : {}),
          removedFromOrganization:
            Boolean(organizationId) && !deletedGlobalUser,
        },
      },
    );
  }

  /**
   * Whether the actor is the organization's primary owner (or a SUPER_ADMIN).
   *
   * `RequestUser` carries no isPrimaryOwner, so the membership is read here and
   * a missing actor, organization or membership is never the primary owner:
   * a caller that cannot be identified cannot reach the owner's account.
   */
  private async isPrimaryOwnerActor(
    actor: ActorContext | undefined,
    organizationId: string | undefined,
  ): Promise<boolean> {
    if (actor?.isSuperAdmin === true) {
      return true;
    }

    if (!actor?.userId || !organizationId) {
      return false;
    }

    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId: actor.userId, organizationId },
      select: { isPrimaryOwner: true },
    });

    return membership?.isPrimaryOwner === true;
  }

  /**
   * Multi-org privacy guard (spec 4.R1, design D4): the User row is a single
   * global identity (email is the unique login key, password/active are
   * shared by every organization the user belongs to). An org admin may only
   * mutate users whose membership is exclusive to their organization; users
   * shared across organizations can only be managed by a SUPER_ADMIN.
   */
  private async assertSingleOrgTarget(userId: string) {
    const membershipCount = await this.prisma.organizationUser.count({
      where: { userId },
    });

    if (membershipCount > 1) {
      throw new ForbiddenException(
        'This user belongs to multiple organizations, so their profile and credentials can only be managed by a SUPER_ADMIN',
      );
    }
  }

  private async ensureEmailAvailable(email: string, excludeUserId?: string) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        email,
        ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
      },
    });

    if (existingUser) {
      throw new ConflictException('User already exists');
    }
  }

  private async findUserOrThrow(userId: string, organizationId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (organizationId) {
      const orgUser = await this.prisma.organizationUser.findFirst({
        where: { userId, organizationId },
      });

      if (!orgUser) {
        throw new ForbiddenException(
          'User does not belong to this organization',
        );
      }
    }

    return user;
  }
}
