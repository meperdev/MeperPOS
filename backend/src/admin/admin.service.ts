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
import { BillingStatus, OrgRole, OrgStatus, PlanType, Prisma } from '@prisma/client';
import { PlanLimitService } from '../plan-limits/plan-limits.service';
import { PLAN_LIMITS, LimitType } from '../plan-limits/plan-limits.constants';
import { DEFAULT_EXPENSE_TAXONOMY } from '../expenses/default-expense-categories';
import { applySystemKeys } from '../settings/settings.service';

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

      for (const [groupName, labels] of Object.entries(DEFAULT_EXPENSE_TAXONOMY)) {
        const group = await tx.expenseGroup.create({
          data: { name: groupName, organizationId: organization.id },
        });
        await tx.expenseLabel.createMany({
          data: labels.map((name) => ({ name, groupId: group.id, organizationId: organization.id })),
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

    const existingSettings =
      organization.settings && typeof organization.settings === 'object'
        ? (organization.settings as Record<string, unknown>)
        : {};

    const data: {
      plan: PlanType;
      settings?: Prisma.InputJsonValue;
    } = { plan: dto.plan };

    if (organization.plan === PlanType.PRO && dto.plan === PlanType.BASIC) {
      const downgradeFlags = await this.calculateDowngradeFlags(id);
      data.settings = applySystemKeys(existingSettings, {
        downgradeFlags,
      }) as Prisma.InputJsonObject;
    }

    return this.prisma.organization.update({
      where: { id },
      data,
    });
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

    const existingMembership =
      await this.prisma.organizationUser.findFirst({
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
      throw new NotFoundException(
        'User is not a member of this organization',
      );
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
      throw new NotFoundException(
        'User is not a member of this organization',
      );
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

    await this.prisma.organization.delete({
      where: { id },
    });

    return { success: true };
  }
}
