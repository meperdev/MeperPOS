import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { BillingStatus, OrgRole, OrgStatus, PlanType } from '@prisma/client';
import { DEFAULT_EXPENSE_TAXONOMY } from '../expenses/default-expense-categories';

describe('AdminService', () => {
  let service: AdminService;

  const prismaMock = {
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === 'function') {
        return arg(prismaMock);
      }
      return Promise.resolve(arg);
    }),
    organization: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    organizationUser: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organizationSequence: {
      createMany: jest.fn(),
    },
    cashRegister: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    expenseGroup: {
      create: jest.fn().mockResolvedValue({ id: 'group-1' }),
    },
    expenseLabel: {
      createMany: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
  };

  const authServiceMock = {
    revokeOrganizationTokens: jest.fn(),
  };

  const planLimitServiceMock = {
    count: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(
      prismaMock as never,
      authServiceMock as never,
      planLimitServiceMock as never,
    );
  });

  describe('createOrganization', () => {
    it('creates organization with a new admin user', async () => {
      prismaMock.organization.findFirst.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        name: 'Admin User',
      });
      prismaMock.organization.create.mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        plan: PlanType.BASIC,
        status: OrgStatus.TRIAL,
      });
      prismaMock.organizationSequence.createMany.mockResolvedValue({
        count: 2,
      });
      prismaMock.cashRegister.create.mockResolvedValue({
        id: 'cr-1',
        organizationId: 'org-1',
        name: 'Caja Principal',
        isDefault: true,
      });

      const result = await service.createOrganization({
        name: 'Test Org',
        slug: 'test-org',
        plan: PlanType.BASIC,
        admin: {
          email: 'admin@example.com',
          name: 'Admin User',
        },
      });

      expect(prismaMock.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Test Org',
            slug: 'test-org',
            status: OrgStatus.TRIAL,
            trialEndsAt: expect.any(Date),
          }),
        }),
      );
      expect(prismaMock.user.create).toHaveBeenCalled();
      expect(prismaMock.organizationUser.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            organizationId: 'org-1',
            role: OrgRole.ADMIN,
            isPrimaryOwner: true,
          }),
        }),
      );
      expect(prismaMock.cashRegister.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            name: 'Caja Principal',
            isDefault: true,
          }),
        }),
      );
      expect(result.organization.slug).toBe('test-org');
      expect(result.tempPassword).toBeDefined();
    });

    it('reuses existing user by email as admin', async () => {
      prismaMock.organization.findFirst.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@example.com',
        name: 'Admin User',
      });
      prismaMock.organization.create.mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        plan: PlanType.BASIC,
        status: OrgStatus.TRIAL,
      });
      prismaMock.organizationSequence.createMany.mockResolvedValue({
        count: 2,
      });
      prismaMock.cashRegister.create.mockResolvedValue({
        id: 'cr-1',
        organizationId: 'org-1',
        name: 'Caja Principal',
        isDefault: true,
      });

      const result = await service.createOrganization({
        name: 'Test Org',
        slug: 'test-org',
        admin: {
          email: 'admin@example.com',
          name: 'Admin User',
        },
      });

      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(prismaMock.cashRegister.create).toHaveBeenCalled();
      expect(result.tempPassword).toBeUndefined();
      expect(result.message).toContain('Existing user assigned');
    });

    it('seeds the five default expense categories inside the creation transaction', async () => {
      prismaMock.organization.findFirst.mockResolvedValue(null);
      prismaMock.organization.create.mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        plan: PlanType.BASIC,
        status: OrgStatus.TRIAL,
      });
      prismaMock.organizationSequence.createMany.mockResolvedValue({
        count: 2,
      });
      prismaMock.cashRegister.create.mockResolvedValue({
        id: 'cr-1',
        organizationId: 'org-1',
        name: 'Caja Principal',
        isDefault: true,
      });
      prismaMock.expenseLabel.createMany.mockResolvedValue({ count: 5 });

      await service.createOrganization({
        name: 'Test Org',
        slug: 'test-org',
      });

      expect(prismaMock.expenseGroup.create).toHaveBeenCalledTimes(
        Object.keys(DEFAULT_EXPENSE_TAXONOMY).length,
      );
      expect(prismaMock.expenseLabel.createMany).toHaveBeenCalled();
    });

    it('fails if slug already exists', async () => {
      prismaMock.organization.findFirst.mockResolvedValue({
        id: 'org-1',
        slug: 'test-org',
      });

      await expect(
        service.createOrganization({
          name: 'Test Org',
          slug: 'test-org',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAllOrganizations', () => {
    it('returns organizations with userCount', async () => {
      prismaMock.organization.findMany.mockResolvedValue([
        {
          id: 'org-1',
          name: 'Org One',
          slug: 'org-one',
          _count: { users: 5 },
        },
        {
          id: 'org-2',
          name: 'Org Two',
          slug: 'org-two',
          _count: { users: 3 },
        },
      ]);

      const result = await service.findAllOrganizations();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'org-1',
          userCount: 5,
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          id: 'org-2',
          userCount: 3,
        }),
      );
    });
  });

  describe('findOrganizationById', () => {
    it('returns organization with users and sequences', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Org One',
        slug: 'org-one',
        users: [
          {
            id: 'ou-1',
            user: {
              id: 'user-1',
              email: 'a@example.com',
              name: 'A',
              active: true,
            },
          },
        ],
        sequences: [{ id: 'seq-1', type: 'SALE', currentNumber: 0 }],
      });

      const result = await service.findOrganizationById('org-1');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'org-1',
          users: expect.any(Array),
          sequences: expect.any(Array),
        }),
      );
    });

    it('throws NotFoundException if organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.findOrganizationById('non-existent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('updates organization status', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: OrgStatus.TRIAL,
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        status: OrgStatus.ACTIVE,
      });

      const result = await service.updateStatus('org-1', {
        status: OrgStatus.ACTIVE,
      });

      expect(result.status).toBe(OrgStatus.ACTIVE);
      expect(authServiceMock.revokeOrganizationTokens).not.toHaveBeenCalled();
    });

    it('revokes tokens if status is SUSPENDED', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: OrgStatus.ACTIVE,
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        status: OrgStatus.SUSPENDED,
      });

      const result = await service.updateStatus('org-1', {
        status: OrgStatus.SUSPENDED,
      });

      expect(result.status).toBe(OrgStatus.SUSPENDED);
      expect(authServiceMock.revokeOrganizationTokens).toHaveBeenCalledWith(
        'org-1',
      );
    });
  });

  describe('updatePlan', () => {
    it('updates organization plan', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
      });

      const result = await service.updatePlan('org-1', { plan: PlanType.PRO });

      expect(result.plan).toBe(PlanType.PRO);
    });

    it('throws NotFoundException if organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePlan('non-existent', { plan: PlanType.PRO }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sets downgradeFlags when downgrading PRO to BASIC', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settings: { someExisting: true },
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
      });
      planLimitServiceMock.count.mockImplementation((type: string) => {
        const counts: Record<string, number> = {
          users: 5,
          products: 200,
          customers: 60,
          cashRegisters: 3,
        };
        return Promise.resolve(counts[type] ?? 0);
      });
      prismaMock.cashRegister.findMany.mockResolvedValue([
        { id: 'cr-2' },
        { id: 'cr-3' },
      ]);

      await service.updatePlan('org-1', { plan: PlanType.BASIC });

      expect(prismaMock.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            settings: expect.objectContaining({
              someExisting: true,
              downgradeFlags: expect.objectContaining({
                usersOverLimit: true,
                productsOverLimit: true,
                customersOverLimit: true,
                cashRegistersDisabled: ['cr-2', 'cr-3'],
              }),
            }),
          }),
        }),
      );
    });

    it('does not set downgradeFlags when upgrading BASIC to PRO', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settings: {},
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
      });

      await service.updatePlan('org-1', { plan: PlanType.PRO });

      expect(prismaMock.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            settings: expect.anything(),
          }),
        }),
      );
    });

    it('sets no downgradeFlags when within BASIC limits', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settings: {},
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
      });
      planLimitServiceMock.count.mockImplementation((type: string) => {
        const counts: Record<string, number> = {
          users: 2,
          products: 50,
          customers: 30,
          cashRegisters: 1,
        };
        return Promise.resolve(counts[type] ?? 0);
      });
      prismaMock.cashRegister.findMany.mockResolvedValue([]);

      await service.updatePlan('org-1', { plan: PlanType.BASIC });

      expect(prismaMock.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            settings: expect.objectContaining({
              downgradeFlags: expect.objectContaining({
                usersOverLimit: false,
                productsOverLimit: false,
                customersOverLimit: false,
                cashRegistersDisabled: [],
              }),
            }),
          }),
        }),
      );
    });
  });

  describe('transferPrimaryOwner', () => {
    it('transfers primary ownership successfully', async () => {
      prismaMock.organizationUser.findFirst
        .mockResolvedValueOnce({
          id: 'ou-current',
          organizationId: 'org-1',
          userId: 'user-current',
          isPrimaryOwner: true,
          role: OrgRole.ADMIN,
        })
        .mockResolvedValueOnce({
          id: 'ou-new',
          organizationId: 'org-1',
          userId: 'user-new',
          isPrimaryOwner: false,
          role: OrgRole.ADMIN,
        });

      prismaMock.organizationUser.update.mockResolvedValue({} as never);

      const result = await service.transferPrimaryOwner(
        'org-1',
        'user-current',
        'user-new',
      );

      expect(prismaMock.organizationUser.findFirst).toHaveBeenCalledTimes(2);
      expect(prismaMock.organizationUser.update).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.newOwnerId).toBe('user-new');
    });

    it('fails if current owner is not primary owner', async () => {
      prismaMock.organizationUser.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.transferPrimaryOwner('org-1', 'user-current', 'user-new'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('fails if new owner is not an ADMIN', async () => {
      prismaMock.organizationUser.findFirst
        .mockResolvedValueOnce({
          id: 'ou-current',
          organizationId: 'org-1',
          userId: 'user-current',
          isPrimaryOwner: true,
          role: OrgRole.ADMIN,
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.transferPrimaryOwner('org-1', 'user-current', 'user-new'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('fails if current and new owner are the same', async () => {
      await expect(
        service.transferPrimaryOwner('org-1', 'user-same', 'user-same'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getMetrics', () => {
    it('returns the status counts, the risk counts and the user counts', async () => {
      prismaMock.organization.count.mockImplementation(
        (args: { where?: Record<string, unknown> } = {}) => {
          const where = args.where ?? {};

          if (where.status === OrgStatus.ACTIVE) return Promise.resolve(7);
          if (where.status === OrgStatus.TRIAL) {
            if (where.trialEndsAt) {
              return Promise.resolve(
                'lt' in (where.trialEndsAt as Record<string, unknown>) ? 1 : 2,
              );
            }
            return Promise.resolve(2);
          }
          if (where.status === OrgStatus.PAST_DUE) return Promise.resolve(1);
          if (where.status === OrgStatus.SUSPENDED) return Promise.resolve(1);
          if (where.billingStatus === BillingStatus.OVERDUE) return Promise.resolve(3);
          if (where.createdAt) return Promise.resolve(4);
          return Promise.resolve(10);
        },
      );
      prismaMock.user.count.mockImplementation(
        (args?: { where?: Record<string, unknown> }) =>
          Promise.resolve(args?.where ? 18 : 25),
      );
      prismaMock.organization.groupBy.mockResolvedValue([
        { plan: PlanType.BASIC, _count: { id: 8 } },
        { plan: PlanType.PRO, _count: { id: 2 } },
      ]);

      const result = await service.getMetrics();

      expect(result).toEqual({
        totalOrganizations: 10,
        activeOrganizations: 7,
        trialOrganizations: 2,
        pastDueOrganizations: 1,
        suspendedOrganizations: 1,
        trialExpiringSoon: 2,
        trialExpired: 1,
        billingOverdue: 3,
        newOrganizationsThisMonth: 4,
        totalUsers: 25,
        activeUsers: 18,
        organizationsByPlan: {
          [PlanType.BASIC]: 8,
          [PlanType.PRO]: 2,
        },
      });
    });

    it('filters the risk counts by the expected where clauses', async () => {
      prismaMock.organization.count.mockResolvedValue(0);
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.organization.groupBy.mockResolvedValue([]);

      await service.getMetrics();

      expect(prismaMock.organization.count).toHaveBeenCalledWith({
        where: { status: OrgStatus.PAST_DUE },
      });
      expect(prismaMock.organization.count).toHaveBeenCalledWith({
        where: {
          status: OrgStatus.TRIAL,
          trialEndsAt: { gte: expect.any(Date), lte: expect.any(Date) },
        },
      });
      expect(prismaMock.organization.count).toHaveBeenCalledWith({
        where: {
          status: OrgStatus.TRIAL,
          trialEndsAt: { lt: expect.any(Date) },
        },
      });
      expect(prismaMock.organization.count).toHaveBeenCalledWith({
        where: { billingStatus: BillingStatus.OVERDUE },
      });
      expect(prismaMock.user.count).toHaveBeenCalledWith({
        where: { active: true, isSuperAdmin: false },
      });
    });
  });

  describe('updateOrganization', () => {
    it('updates organization details', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Old Name',
        slug: 'old-slug',
      });
      prismaMock.organization.findFirst.mockResolvedValue(null);
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        name: 'New Name',
        slug: 'new-slug',
        taxId: '900123456-7',
        phone: '+57 300 123 4567',
        address: 'Calle 123',
        active: true,
      });

      const result = await service.updateOrganization('org-1', {
        name: 'New Name',
        slug: 'new-slug',
        taxId: '900123456-7',
        phone: '+57 300 123 4567',
        address: 'Calle 123',
        active: true,
      });

      expect(result.name).toBe('New Name');
      expect(result.slug).toBe('new-slug');
      expect(prismaMock.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org-1' },
          data: expect.objectContaining({ name: 'New Name', slug: 'new-slug' }),
        }),
      );
    });

    it('throws NotFoundException if organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOrganization('non-existent', { name: 'New' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException if slug is taken by another organization', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Org One',
        slug: 'old-slug',
      });
      prismaMock.organization.findFirst.mockResolvedValue({
        id: 'org-2',
        slug: 'taken-slug',
      });

      await expect(
        service.updateOrganization('org-1', { slug: 'taken-slug' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows keeping the same slug (no conflict with itself)', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Org One',
        slug: 'my-slug',
      });
      prismaMock.organization.findFirst.mockResolvedValue(null);
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        name: 'Org One Updated',
        slug: 'my-slug',
      });

      const result = await service.updateOrganization('org-1', {
        name: 'Org One Updated',
        slug: 'my-slug',
      });

      expect(result.slug).toBe('my-slug');
      expect(result.name).toBe('Org One Updated');
    });
  });

  describe('addOrganizationMember', () => {
    it('creates a new user and adds to organization with role', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Org One',
      });
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'newuser@example.com',
        name: 'New User',
      });
      prismaMock.organizationUser.findFirst.mockResolvedValue(null);
      prismaMock.organizationUser.create.mockResolvedValue({
        id: 'ou-new',
        userId: 'user-new',
        organizationId: 'org-1',
        role: OrgRole.CASHIER,
        isPrimaryOwner: false,
        joinedAt: new Date(),
      });

      const result = await service.addOrganizationMember('org-1', {
        email: 'newuser@example.com',
        name: 'New User',
        role: OrgRole.CASHIER,
      });

      expect(prismaMock.user.create).toHaveBeenCalled();
      expect(prismaMock.organizationUser.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-new',
            organizationId: 'org-1',
            role: OrgRole.CASHIER,
          }),
        }),
      );
      expect(result.tempPassword).toBeDefined();
    });

    it('links existing user to organization', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Org One',
      });
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: 'existing@example.com',
        name: 'Existing User',
      });
      prismaMock.organizationUser.findFirst.mockResolvedValue(null);
      prismaMock.organizationUser.create.mockResolvedValue({
        id: 'ou-1',
        userId: 'existing-user',
        organizationId: 'org-1',
        role: OrgRole.MEMBER,
        isPrimaryOwner: false,
        joinedAt: new Date(),
      });

      const result = await service.addOrganizationMember('org-1', {
        email: 'existing@example.com',
        role: OrgRole.MEMBER,
      });

      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(result.tempPassword).toBeUndefined();
      expect(result.organizationUser.role).toBe(OrgRole.MEMBER);
    });

    it('throws NotFoundException if organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.addOrganizationMember('non-existent', {
          email: 'test@example.com',
          role: OrgRole.MEMBER,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException if user is already a member', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Org One',
      });
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: 'existing@example.com',
        name: 'Existing User',
      });
      prismaMock.organizationUser.findFirst.mockResolvedValue({
        id: 'ou-1',
        userId: 'existing-user',
        organizationId: 'org-1',
        role: OrgRole.MEMBER,
      });

      await expect(
        service.addOrganizationMember('org-1', {
          email: 'existing@example.com',
          role: OrgRole.CASHIER,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateMemberRole', () => {
    it('updates a member role successfully', async () => {
      prismaMock.organizationUser.findFirst.mockResolvedValue({
        id: 'ou-1',
        userId: 'user-1',
        organizationId: 'org-1',
        role: OrgRole.MEMBER,
        isPrimaryOwner: false,
      });
      prismaMock.organizationUser.update.mockResolvedValue({
        id: 'ou-1',
        userId: 'user-1',
        organizationId: 'org-1',
        role: OrgRole.ADMIN,
        isPrimaryOwner: false,
      });

      const result = await service.updateMemberRole(
        'org-1',
        'user-1',
        OrgRole.ADMIN,
      );

      expect(result.role).toBe(OrgRole.ADMIN);
      expect(prismaMock.organizationUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ou-1' },
          data: { role: OrgRole.ADMIN },
        }),
      );
    });

    it('throws NotFoundException if membership does not exist', async () => {
      prismaMock.organizationUser.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMemberRole('org-1', 'user-99', OrgRole.ADMIN),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeOrganizationMember', () => {
    it('removes a non-owner member successfully', async () => {
      prismaMock.organizationUser.findFirst.mockResolvedValue({
        id: 'ou-2',
        userId: 'user-2',
        organizationId: 'org-1',
        role: OrgRole.CASHIER,
        isPrimaryOwner: false,
      });
      prismaMock.organizationUser.delete.mockResolvedValue({
        id: 'ou-2',
      });

      const result = await service.removeOrganizationMember(
        'org-1',
        'user-2',
      );

      expect(prismaMock.organizationUser.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ou-2' } }),
      );
      expect(result.success).toBe(true);
    });

    it('throws BadRequestException when removing primary owner', async () => {
      prismaMock.organizationUser.findFirst.mockResolvedValue({
        id: 'ou-1',
        userId: 'user-1',
        organizationId: 'org-1',
        role: OrgRole.ADMIN,
        isPrimaryOwner: true,
      });

      await expect(
        service.removeOrganizationMember('org-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException if membership does not exist', async () => {
      prismaMock.organizationUser.findFirst.mockResolvedValue(null);

      await expect(
        service.removeOrganizationMember('org-1', 'user-99'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteOrganization', () => {
    it('deletes organization when confirmation name matches', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Tienda Principal',
      });
      prismaMock.organization.delete.mockResolvedValue({
        id: 'org-1',
        name: 'Tienda Principal',
      });

      const result = await service.deleteOrganization('org-1', {
        confirmOrganizationName: 'Tienda Principal',
      });

      expect(prismaMock.organization.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'org-1' } }),
      );
      expect(result.success).toBe(true);
    });

    it('throws BadRequestException when confirmation name does not match', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Tienda Principal',
      });

      await expect(
        service.deleteOrganization('org-1', {
          confirmOrganizationName: 'Wrong Name',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException if organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteOrganization('non-existent', {
          confirmOrganizationName: 'Anything',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
