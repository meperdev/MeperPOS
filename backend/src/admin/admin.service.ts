import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BCRYPT_ROUNDS } from '../common/constants/security.constants';
import { trialEndsAt } from '../common/constants/trial.constants';
import { AuthService } from '../auth/auth.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationStatusDto } from './dto/update-organization-status.dto';
import { UpdateOrganizationPlanDto } from './dto/update-organization-plan.dto';
import {
  BillingStatus,
  OrgRole,
  OrgStatus,
  PlanType,
  Prisma,
} from '@prisma/client';
import { PlanLimitService } from '../plan-limits/plan-limits.service';
import { PLAN_LIMITS, LimitType } from '../plan-limits/plan-limits.constants';
import { DEFAULT_EXPENSE_TAXONOMY } from '../expenses/default-expense-categories';
import { applySystemKeys } from '../settings/settings.service';
import {
  ELECTRONIC_INVOICING_KEY,
  isElectronicInvoicingActive,
} from '../settings/schema';
import { UpdateElectronicInvoicingDto } from './dto/update-electronic-invoicing.dto';

/** `1 fiscal document` / `3 fiscal documents`, for the delete conflict. */
function describeFiscalDocuments(count: number): string {
  return `${count} fiscal document${count === 1 ? '' : 's'}`;
}

/**
 * Whether a failed write was refused by the fiscal document constraint.
 *
 * Only that constraint is translated into a conflict here: other restricted
 * relations (payroll, for one) are real failures with their own diagnosis and
 * must keep it.
 */
function isFiscalDocumentReference(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code !== 'P2003') {
    return false;
  }
  // Prisma 6 reports the violated constraint name in `meta.constraint`, e.g.
  // `FiscalDocument_organizationId_fkey`. The runtime type is not part of the
  // public type, so it is narrowed instead of coerced.
  const constraint: unknown = error.meta?.constraint;
  return (
    typeof constraint === 'string' && constraint.includes('FiscalDocument')
  );
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
    private planLimitService: PlanLimitService,
  ) {}

  async createOrganization(dto: CreateOrganizationDto) {
    return this.prisma.$transaction(async (tx) => {
      const existingOrg = await tx.organization.findFirst({
        where: { slug: dto.slug },
      });

      if (existingOrg) {
        throw new ConflictException('Organization slug already exists');
      }

      let adminUser: { id: string; email: string; name: string } | null = null;
      let tempPassword: string | null = null;

      if (dto.admin) {
        const existingUser = await tx.user.findUnique({
          where: { email: dto.admin.email },
        });

        if (existingUser) {
          adminUser = existingUser;
        } else {
          tempPassword =
            dto.admin.password || crypto.randomBytes(8).toString('hex');
          const hashedPassword = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

          adminUser = await tx.user.create({
            data: {
              email: dto.admin.email,
              name: dto.admin.name,
              password: hashedPassword,
            },
          });
        }
      }

      const organization = await tx.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          plan: dto.plan ?? PlanType.BASIC,
          status: OrgStatus.TRIAL,
          trialEndsAt: trialEndsAt(),
        },
      });

      if (adminUser) {
        await tx.organizationUser.create({
          data: {
            userId: adminUser.id,
            organizationId: organization.id,
            role: OrgRole.ADMIN,
            isPrimaryOwner: true,
          },
        });
      }

      const currentYear = new Date().getFullYear();

      await tx.organizationSequence.createMany({
        data: [
          {
            organizationId: organization.id,
            type: 'SALE',
            currentNumber: 0,
            year: currentYear,
          },
          {
            organizationId: organization.id,
            type: 'PO',
            currentNumber: 0,
            year: currentYear,
          },
        ],
      });

      await tx.cashRegister.create({
        data: {
          organizationId: organization.id,
          name: 'Caja Principal',
          isDefault: true,
        },
      });

      for (const [groupName, labels] of Object.entries(
        DEFAULT_EXPENSE_TAXONOMY,
      )) {
        const group = await tx.expenseGroup.create({
          data: { name: groupName, organizationId: organization.id },
        });
        await tx.expenseLabel.createMany({
          data: labels.map((name) => ({
            name,
            groupId: group.id,
            organizationId: organization.id,
          })),
        });
      }

      return {
        organization,
        adminUser: adminUser
          ? { id: adminUser.id, email: adminUser.email, name: adminUser.name }
          : undefined,
        tempPassword: tempPassword ?? undefined,
        message: adminUser
          ? tempPassword
            ? 'Organization created successfully with a new admin user. Temporary password provided.'
            : 'Organization created successfully. Existing user assigned as admin.'
          : 'Organization created successfully. No admin assigned.',
      };
    });
  }

  async findAllOrganizations() {
    const organizations = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    return organizations.map((org) => ({
      ...org,
      userCount: org._count.users,
      _count: undefined,
    }));
  }

  async findOrganizationById(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                active: true,
              },
            },
          },
        },
        sequences: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async updateStatus(id: string, dto: UpdateOrganizationStatusDto) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data: { status: dto.status },
    });

    if (dto.status === OrgStatus.SUSPENDED) {
      await this.authService.revokeOrganizationTokens(id);
    }

    return updated;
  }

  async updatePlan(id: string, dto: UpdateOrganizationPlanDto) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const isDowngrade =
      organization.plan === PlanType.PRO && dto.plan === PlanType.BASIC;

    // PRO -> BASIC is the only transition that recomputes the downgrade flags.
    // Upgrades and no-ops keep the historically retained flags and never
    // rewrite the settings blob.
    let settings: Prisma.InputJsonObject | undefined;

    if (isDowngrade) {
      const existingSettings =
        organization.settings && typeof organization.settings === 'object'
          ? (organization.settings as Record<string, unknown>)
          : {};

      settings = applySystemKeys(existingSettings, {
        downgradeFlags: await this.calculateDowngradeFlags(id),
      }) as Prisma.InputJsonObject;
    }

    try {
      // Every plan change, including the one that writes no settings, takes
      // part in the `settingsVersion` guard (spec S9). A single atomic
      // `UPDATE ... RETURNING` gives three properties the previous shapes
      // could not have at once:
      //
      // - the version read above and the write are one statement, so a
      //   plan-only change cannot overwrite a downgrade that landed in between
      //   (nor the reverse), and a concurrent activation or settings write must
      //   retry instead of clobbering;
      // - every plan change consumes the version, so those writers notice it
      //   even though the plan-only path leaves the blob untouched;
      // - the response is the exact row this statement wrote, never a second
      //   read that another writer could have changed in between.
      return await this.prisma.organization.update({
        where: { id, settingsVersion: organization.settingsVersion },
        data: {
          plan: dto.plan,
          ...(settings === undefined ? {} : { settings }),
          settingsVersion: { increment: 1 },
        },
      });
    } catch (error) {
      // `update` with a non-unique version filter reports a lost race as P2025
      // ("record to update not found"), exactly like a stale CAS. Anything else
      // is a real failure and must not be disguised as a conflict.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException(
          'Organization plan or settings were modified concurrently. Reload and try again.',
        );
      }
      throw error;
    }
  }

  private async calculateDowngradeFlags(organizationId: string) {
    const basicLimits = PLAN_LIMITS.BASIC;
    const limitTypes: LimitType[] = [
      'users',
      'products',
      'customers',
      'cashRegisters',
    ];

    const counts = Object.fromEntries(
      await Promise.all(
        limitTypes.map(async (type) => [
          type,
          await this.planLimitService.count(type, organizationId),
        ]),
      ),
    ) as Record<LimitType, number>;

    const excessCashRegisters =
      counts.cashRegisters > basicLimits.maxCashRegisters
        ? await this.prisma.cashRegister.findMany({
            where: { organizationId, active: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            skip: basicLimits.maxCashRegisters,
            select: { id: true },
          })
        : [];

    return {
      usersOverLimit: counts.users > basicLimits.maxUsers,
      productsOverLimit: counts.products > basicLimits.maxProducts,
      customersOverLimit: counts.customers > basicLimits.maxCustomers,
      cashRegistersDisabled: excessCashRegisters.map((register) => register.id),
    };
  }

  async transferPrimaryOwner(
    organizationId: string,
    currentOwnerId: string,
    newOwnerId: string,
  ) {
    if (currentOwnerId === newOwnerId) {
      throw new BadRequestException(
        'Current owner and new owner must be different',
      );
    }

    const currentOwner = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId: currentOwnerId,
        isPrimaryOwner: true,
      },
    });

    if (!currentOwner) {
      throw new ForbiddenException(
        'Current user is not the primary owner of this organization',
      );
    }

    const newOwner = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId: newOwnerId,
        role: OrgRole.ADMIN,
      },
    });

    if (!newOwner) {
      throw new ForbiddenException(
        'New owner must be an ADMIN member of this organization',
      );
    }

    await this.prisma.$transaction([
      this.prisma.organizationUser.update({
        where: { id: currentOwner.id },
        data: { isPrimaryOwner: false },
      }),
      this.prisma.organizationUser.update({
        where: { id: newOwner.id },
        data: { isPrimaryOwner: true },
      }),
    ]);

    return {
      success: true,
      message: 'Primary ownership transferred successfully',
      organizationId,
      previousOwnerId: currentOwnerId,
      newOwnerId,
    };
  }

  async getMetrics() {
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalOrgs,
      activeOrgs,
      trialOrgs,
      pastDueOrgs,
      suspendedOrgs,
      trialExpiringSoon,
      trialExpired,
      billingOverdue,
      newOrgsThisMonth,
      totalUsers,
      activeUsers,
      orgsByPlan,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { status: OrgStatus.ACTIVE } }),
      this.prisma.organization.count({ where: { status: OrgStatus.TRIAL } }),
      this.prisma.organization.count({ where: { status: OrgStatus.PAST_DUE } }),
      this.prisma.organization.count({
        where: { status: OrgStatus.SUSPENDED },
      }),
      this.prisma.organization.count({
        where: {
          status: OrgStatus.TRIAL,
          trialEndsAt: { gte: now, lte: weekAhead },
        },
      }),
      this.prisma.organization.count({
        where: { status: OrgStatus.TRIAL, trialEndsAt: { lt: now } },
      }),
      this.prisma.organization.count({
        where: { billingStatus: BillingStatus.OVERDUE },
      }),
      this.prisma.organization.count({
        where: { createdAt: { gte: monthStart } },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { active: true, isSuperAdmin: false },
      }),
      this.prisma.organization.groupBy({
        by: ['plan'],
        _count: { id: true },
      }),
    ]);

    return {
      totalOrganizations: totalOrgs,
      activeOrganizations: activeOrgs,
      trialOrganizations: trialOrgs,
      pastDueOrganizations: pastDueOrgs,
      suspendedOrganizations: suspendedOrgs,
      trialExpiringSoon,
      trialExpired,
      billingOverdue,
      newOrganizationsThisMonth: newOrgsThisMonth,
      totalUsers,
      activeUsers,
      organizationsByPlan: orgsByPlan.reduce(
        (acc, curr) => {
          acc[curr.plan] = curr._count.id;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  async updateOrganization(
    id: string,
    dto: {
      name?: string;
      slug?: string;
      taxId?: string;
      phone?: string;
      address?: string;
      logoUrl?: string;
      active?: boolean;
    },
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    if (dto.slug && dto.slug !== organization.slug) {
      const slugExists = await this.prisma.organization.findFirst({
        where: { slug: dto.slug, id: { not: id } },
      });

      if (slugExists) {
        throw new ConflictException('Organization slug already exists');
      }
    }

    return this.prisma.organization.update({
      where: { id },
      data: { ...dto },
    });
  }

  /**
   * Spec S9 — activation is a SUPER_ADMIN decision, not an organization one.
   *
   * The flag lives in the backend-managed `electronicInvoicing` system key, so
   * the user settings PUT can neither read nor write it. Its only effect is
   * local: a registered sale writes an internal PENDING fiscal record through
   * `emitFiscalDocumentForSale`. Nothing is signed, numbered or sent, and this
   * method never creates a fiscal document or contacts DIAN (spec S6).
   *
   * The write is guarded by `settingsVersion`, exactly like `SettingsService`,
   * so activation cannot silently clobber a concurrent settings write and a
   * concurrent write cannot resurrect a stale flag.
   */
  async updateElectronicInvoicing(
    id: string,
    dto: UpdateElectronicInvoicingDto,
  ) {
    // Defence in depth: the DTO already refuses anything but a JSON boolean,
    // and a caller that bypasses the HTTP boundary must not activate with a
    // truthy string either.
    if (typeof dto.enabled !== 'boolean') {
      throw new BadRequestException(
        'Electronic invoicing activation requires an explicit boolean',
      );
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, settings: true, settingsVersion: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // A malformed blob must not stop activation: a non-object becomes an empty
    // blob. Otherwise every existing key is preserved and only the activation
    // key is overlaid (`applySystemKeys` never full-replaces).
    const existingSettings =
      organization.settings &&
      typeof organization.settings === 'object' &&
      !Array.isArray(organization.settings)
        ? (organization.settings as Record<string, unknown>)
        : {};

    const settings = applySystemKeys(existingSettings, {
      [ELECTRONIC_INVOICING_KEY]: { enabled: dto.enabled },
    }) as Prisma.InputJsonObject;

    const changed = await this.prisma.organization.updateMany({
      where: { id, settingsVersion: organization.settingsVersion },
      data: { settings, settingsVersion: { increment: 1 } },
    });

    if (changed.count === 0) {
      throw new ConflictException(
        'Organization settings were modified concurrently. Reload and try again.',
      );
    }

    return {
      organizationId: organization.id,
      // Read back through the same helper the sale path uses, so the response
      // reports what a reader will actually see.
      electronicInvoicing: { enabled: isElectronicInvoicingActive(settings) },
    };
  }

  async addOrganizationMember(
    organizationId: string,
    dto: {
      email: string;
      name?: string;
      role: OrgRole;
      password?: string;
    },
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    let user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    let tempPassword: string | undefined;

    if (!user) {
      tempPassword = dto.password || crypto.randomBytes(8).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name || dto.email,
          password: hashedPassword,
        },
      });
    }

    const existingMembership = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId: user.id,
      },
    });

    if (existingMembership) {
      throw new ConflictException(
        'User is already a member of this organization',
      );
    }

    const organizationUser = await this.prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId,
        role: dto.role,
        isPrimaryOwner: false,
      },
    });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      organizationUser,
      tempPassword,
    };
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: OrgRole,
  ) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId },
    });

    if (!membership) {
      throw new NotFoundException('User is not a member of this organization');
    }

    return this.prisma.organizationUser.update({
      where: { id: membership.id },
      data: { role },
    });
  }

  async removeOrganizationMember(organizationId: string, userId: string) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId },
    });

    if (!membership) {
      throw new NotFoundException('User is not a member of this organization');
    }

    if (membership.isPrimaryOwner) {
      throw new BadRequestException(
        'Cannot remove the primary owner. Transfer ownership first.',
      );
    }

    await this.prisma.organizationUser.delete({
      where: { id: membership.id },
    });

    return { success: true };
  }

  async deleteOrganization(
    id: string,
    dto: { confirmOrganizationName: string },
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    if (organization.name !== dto.confirmOrganizationName) {
      throw new BadRequestException(
        'Confirmation name does not match organization name',
      );
    }

    // A fiscal document is evidence of what the organization declared, so it
    // must survive the organization that issued it. The rule itself lives in the
    // database (`FiscalDocument_organizationId_fkey` is ON DELETE RESTRICT); this
    // count only turns that refusal into an answer the caller can act on. A
    // count that went stale between the read and the delete still lands on the
    // same conflict, because the constraint is what actually decides.
    const fiscalDocuments = await this.prisma.fiscalDocument.count({
      where: { organizationId: id },
    });
    if (fiscalDocuments > 0) {
      throw new ConflictException(
        `Organization cannot be deleted: it still holds ${describeFiscalDocuments(fiscalDocuments)}`,
      );
    }

    try {
      await this.prisma.organization.delete({ where: { id } });
    } catch (error) {
      if (isFiscalDocumentReference(error)) {
        throw new ConflictException(
          'Organization cannot be deleted: it still holds fiscal documents',
        );
      }
      throw error;
    }

    return { success: true };
  }
}
