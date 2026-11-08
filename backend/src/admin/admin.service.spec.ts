import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  BillingStatus,
  OrgRole,
  OrgStatus,
  PlanType,
  Prisma,
} from '@prisma/client';
import { DEFAULT_EXPENSE_TAXONOMY } from '../expenses/default-expense-categories';
import { isElectronicInvoicingActive } from '../settings/schema';
import { mergeSettingsJson } from '../settings/settings.service';

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
    // Activation flips a setting only; it must never mint a fiscal record.
    // `count` is what the organization delete reads before it removes anything.
    fiscalDocument: {
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
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
    // `clearAllMocks` keeps queued `mockResolvedValueOnce` implementations, so a
    // test that stops mid-sequence would leak values into the next one. These
    // three are the mocks the settings CAS sequences with `...Once`.
    prismaMock.organization.findUnique.mockReset();
    prismaMock.organization.update.mockReset();
    prismaMock.organization.updateMany.mockReset();
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
    /** The single guarded `update` this method is expected to issue. */
    function guardedWrite(): {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    } {
      const calls = prismaMock.organization.update.mock.calls as [
        { where: Record<string, unknown>; data: Record<string, unknown> },
      ][];
      return calls[0][0];
    }

    /** The settings blob the downgrade wrote through the version guard. */
    function writtenSettings(): Record<string, unknown> {
      return guardedWrite().data.settings as Record<string, unknown>;
    }

    /** A lost version race: Prisma reports "record to update not found". */
    function versionConflict(): Prisma.PrismaClientKnownRequestError {
      return new Prisma.PrismaClientKnownRequestError(
        'An operation failed because it depends on one or more records that were required but not found.',
        { code: 'P2025', clientVersion: 'test' },
      );
    }

    function withinBasicLimits(): void {
      planLimitServiceMock.count.mockResolvedValue(1);
      prismaMock.cashRegister.findMany.mockResolvedValue([]);
    }

    it('updates organization plan', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settingsVersion: 3,
        settings: {},
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 4,
      });

      const result = await service.updatePlan('org-1', { plan: PlanType.PRO });

      // F1: the plan-only write takes part too -- it consumes the exact
      // settingsVersion it read and does not rewrite the settings blob.
      expect(prismaMock.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1', settingsVersion: 3 },
        data: { plan: PlanType.PRO, settingsVersion: { increment: 1 } },
      });
      expect(prismaMock.organization.updateMany).not.toHaveBeenCalled();
      // F2: the response is the row the guarded write returned, no read-back.
      expect(result).toEqual({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 4,
      });
      expect(prismaMock.organization.findUnique).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException if organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePlan('non-existent', { plan: PlanType.PRO }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prismaMock.organization.update).not.toHaveBeenCalled();
    });

    it('answers with the exact row the guarded write returned, without a read-back', async () => {
      // F2: an `updateMany` + `findUnique` pair can answer with a row another
      // writer changed between the two statements. One RETURNING update cannot.
      const written = {
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 5,
        settings: { printHeader: 'H' },
      };
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settingsVersion: 4,
        settings: {},
      });
      prismaMock.organization.update.mockResolvedValue(written);

      const result = await service.updatePlan('org-1', { plan: PlanType.PRO });

      expect(result).toBe(written);
      expect(prismaMock.organization.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.organization.updateMany).not.toHaveBeenCalled();
    });

    it('sets downgradeFlags when downgrading PRO to BASIC', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 3,
        settings: { someExisting: true },
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settingsVersion: 4,
        settings: {
          someExisting: true,
          downgradeFlags: { usersOverLimit: true },
        },
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

      const result = await service.updatePlan('org-1', {
        plan: PlanType.BASIC,
      });

      expect(prismaMock.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1', settingsVersion: 3 },
        data: {
          plan: PlanType.BASIC,
          settings: expect.objectContaining({
            someExisting: true,
            downgradeFlags: expect.objectContaining({
              usersOverLimit: true,
              productsOverLimit: true,
              customersOverLimit: true,
              cashRegistersDisabled: ['cr-2', 'cr-3'],
            }),
          }),
          settingsVersion: { increment: 1 },
        },
      });
      // No unguarded or two-statement write is left on this path.
      expect(prismaMock.organization.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.organization.findUnique).toHaveBeenCalledTimes(1);
      expect(result.plan).toBe(PlanType.BASIC);
    });

    it('does not set downgradeFlags when upgrading BASIC to PRO', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settingsVersion: 0,
        settings: {},
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
      });

      await service.updatePlan('org-1', { plan: PlanType.PRO });

      // Historical policy preserved: an upgrade never rewrites settings, so any
      // previously retained downgradeFlags stay untouched.
      expect(prismaMock.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1', settingsVersion: 0 },
        data: { plan: PlanType.PRO, settingsVersion: { increment: 1 } },
      });
      expect(planLimitServiceMock.count).not.toHaveBeenCalled();
    });

    it('does not recompute flags when the plan already matches the request', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 9,
        settings: { downgradeFlags: { usersOverLimit: true } },
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 10,
      });

      const result = await service.updatePlan('org-1', { plan: PlanType.PRO });

      expect(prismaMock.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1', settingsVersion: 9 },
        data: { plan: PlanType.PRO, settingsVersion: { increment: 1 } },
      });
      expect(planLimitServiceMock.count).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 10,
      });
    });

    it('sets no downgradeFlags when within BASIC limits', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 1,
        settings: {},
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settingsVersion: 2,
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
          where: { id: 'org-1', settingsVersion: 1 },
          data: expect.objectContaining({
            settings: expect.objectContaining({
              downgradeFlags: {
                usersOverLimit: false,
                productsOverLimit: false,
                customersOverLimit: false,
                cashRegistersDisabled: [],
              },
            }),
            settingsVersion: { increment: 1 },
          }),
        }),
      );
    });

    it('keeps the activation flag and every other key when downgrading', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 6,
        settings: {
          printHeader: 'Mi Negocio',
          custom: { loyalty: 'true' },
          legacyKey: 'preserved',
          electronicInvoicing: { enabled: true },
        },
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settingsVersion: 7,
      });
      withinBasicLimits();

      await service.updatePlan('org-1', { plan: PlanType.BASIC });

      expect(writtenSettings()).toEqual({
        printHeader: 'Mi Negocio',
        custom: { loyalty: 'true' },
        legacyKey: 'preserved',
        electronicInvoicing: { enabled: true },
        downgradeFlags: {
          usersOverLimit: false,
          productsOverLimit: false,
          customersOverLimit: false,
          cashRegistersDisabled: [],
        },
      });
      // Differential check with the reader the sale path uses (spec S9): a
      // downgrade must not switch invoicing off behind the SUPER_ADMIN's back.
      expect(isElectronicInvoicingActive(writtenSettings())).toBe(true);
    });

    it('writes a blob the user settings merge keeps intact', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 2,
        settings: { electronicInvoicing: { enabled: true } },
      });
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settingsVersion: 3,
      });
      withinBasicLimits();

      await service.updatePlan('org-1', { plan: PlanType.BASIC });

      // Differential check with the shared settings engine: this is the very
      // merge the user settings PUT applies to the blob the downgrade wrote.
      const merged = mergeSettingsJson(writtenSettings(), {
        printFooter: 'Gracias',
      } as never);

      expect(merged.printFooter).toBe('Gracias');
      expect(merged.downgradeFlags).toEqual(
        expect.objectContaining({ usersOverLimit: false }),
      );
      expect(isElectronicInvoicingActive(merged)).toBe(true);
    });

    it('answers 409 instead of writing stale downgrade flags when the settings changed', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 5,
        settings: {},
      });
      prismaMock.organization.update.mockRejectedValue(versionConflict());
      withinBasicLimits();

      await expect(
        service.updatePlan('org-1', { plan: PlanType.BASIC }),
      ).rejects.toBeInstanceOf(ConflictException);

      // The guarded statement used the version it read, and nothing else wrote.
      expect(guardedWrite().where).toEqual({
        id: 'org-1',
        settingsVersion: 5,
      });
      expect(prismaMock.organization.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.organization.findUnique).toHaveBeenCalledTimes(1);
    });

    it('answers 409 instead of overwriting a downgrade that landed first', async () => {
      // F1: a plan-only write derived from a pre-downgrade read must not
      // overwrite the downgrade's plan. Every updatePlan write is version
      // guarded, so the loser of the race answers 409.
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settingsVersion: 6,
        settings: { downgradeFlags: { usersOverLimit: true } },
      });
      prismaMock.organization.update.mockRejectedValue(versionConflict());

      await expect(
        service.updatePlan('org-1', { plan: PlanType.PRO }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(guardedWrite().where).toEqual({
        id: 'org-1',
        settingsVersion: 6,
      });
      expect(planLimitServiceMock.count).not.toHaveBeenCalled();
      expect(prismaMock.organization.updateMany).not.toHaveBeenCalled();
    });

    it('rethrows a database error that is not a lost version race', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        settingsVersion: 0,
        settings: {},
      });
      prismaMock.organization.update.mockRejectedValue(new Error('boom'));

      await expect(
        service.updatePlan('org-1', { plan: PlanType.PRO }),
      ).rejects.toThrow('boom');
    });

    it('serializes a downgrade and a plan-only write on the same settings version', async () => {
      const stale = {
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 4,
        settings: {},
      };
      // Both writers read the same version before either one writes.
      prismaMock.organization.findUnique
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce(stale);
      prismaMock.organization.update
        .mockResolvedValueOnce({
          id: 'org-1',
          plan: PlanType.BASIC,
          settingsVersion: 5,
        }) // the downgrade wins version 4
        .mockRejectedValueOnce(versionConflict()); // the plan-only write loses
      withinBasicLimits();

      await service.updatePlan('org-1', { plan: PlanType.BASIC });

      await expect(
        service.updatePlan('org-1', { plan: PlanType.PRO }),
      ).rejects.toBeInstanceOf(ConflictException);

      const downgradeCall = prismaMock.organization.update.mock.calls[0][0];
      const planOnlyCall = prismaMock.organization.update.mock.calls[1][0];
      expect(downgradeCall.where).toEqual({
        id: 'org-1',
        settingsVersion: 4,
      });
      expect(planOnlyCall.where).toEqual({
        id: 'org-1',
        settingsVersion: 4,
      });
    });

    it('cannot apply a stale downgrade after activation consumed the version', async () => {
      const stale = {
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 4,
        settings: { printHeader: 'Mi Negocio' },
      };
      prismaMock.organization.findUnique
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce(stale);
      prismaMock.organization.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.organization.update.mockRejectedValueOnce(versionConflict());
      withinBasicLimits();

      await service.updateElectronicInvoicing('org-1', { enabled: true });

      await expect(
        service.updatePlan('org-1', { plan: PlanType.BASIC }),
      ).rejects.toBeInstanceOf(ConflictException);

      const activationCall =
        prismaMock.organization.updateMany.mock.calls[0][0];
      const downgradeCall = prismaMock.organization.update.mock.calls[0][0];
      // Both writers guard on the same key, so exactly one of them applies.
      expect(activationCall.where).toEqual({
        id: 'org-1',
        settingsVersion: 4,
      });
      expect(downgradeCall.where).toEqual({
        id: 'org-1',
        settingsVersion: 4,
      });
      expect(
        isElectronicInvoicingActive(
          (activationCall.data as { settings: unknown }).settings,
        ),
      ).toBe(true);
    });

    it('cannot activate over downgrade flags the downgrade already wrote', async () => {
      const beforeDowngrade = {
        id: 'org-1',
        plan: PlanType.PRO,
        settingsVersion: 8,
        settings: { printHeader: 'H' },
      };
      prismaMock.organization.findUnique
        .mockResolvedValueOnce(beforeDowngrade) // downgrade read
        .mockResolvedValueOnce(beforeDowngrade); // activation read, now stale
      prismaMock.organization.update.mockResolvedValueOnce({
        ...beforeDowngrade,
        plan: PlanType.BASIC,
        settingsVersion: 9,
      });
      prismaMock.organization.updateMany.mockResolvedValueOnce({ count: 0 });
      withinBasicLimits();

      await service.updatePlan('org-1', { plan: PlanType.BASIC });

      await expect(
        service.updateElectronicInvoicing('org-1', { enabled: true }),
      ).rejects.toBeInstanceOf(ConflictException);
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
          if (where.billingStatus === BillingStatus.OVERDUE)
            return Promise.resolve(3);
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

      const result = await service.removeOrganizationMember('org-1', 'user-2');

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
    /** Prisma 6's shape for a foreign key that refused a delete. */
    function foreignKeyRefusal(constraint: string) {
      return new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint violated on the constraint: ' + constraint,
        {
          code: 'P2003',
          clientVersion: '6.19.2',
          meta: { modelName: 'Organization', constraint },
        },
      );
    }

    it('deletes organization when confirmation name matches', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Tienda Principal',
      });
      prismaMock.fiscalDocument.count.mockResolvedValue(0);
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

    it('refuses to delete an organization that still holds fiscal documents', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Tienda Principal',
      });
      prismaMock.fiscalDocument.count.mockResolvedValue(2);

      await expect(
        service.deleteOrganization('org-1', {
          confirmOrganizationName: 'Tienda Principal',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // The whole point of the check: the rows are still there afterwards.
      expect(prismaMock.organization.delete).not.toHaveBeenCalled();
      expect(prismaMock.fiscalDocument.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
      });
    });

    it('says how many fiscal documents are keeping the organization alive', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Tienda Principal',
      });
      prismaMock.fiscalDocument.count.mockResolvedValue(2);

      await expect(
        service.deleteOrganization('org-1', {
          confirmOrganizationName: 'Tienda Principal',
        }),
      ).rejects.toThrow('2 fiscal documents');
    });

    it('answers 409 when the database refuses the delete because a fiscal document appeared', async () => {
      // The count can be stale: a sale may register its document between the
      // read and the delete. The database constraint is what actually holds the
      // invariant, and its refusal must reach the caller as a conflict.
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Tienda Principal',
      });
      prismaMock.fiscalDocument.count.mockResolvedValue(0);
      prismaMock.organization.delete.mockRejectedValue(
        foreignKeyRefusal('FiscalDocument_organizationId_fkey'),
      );

      await expect(
        service.deleteOrganization('org-1', {
          confirmOrganizationName: 'Tienda Principal',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers 409 when the refusal names the sale-side fiscal constraint', async () => {
      // An organization delete cascades into its sales, so the database may
      // refuse on the composite sale constraint instead of the organization
      // one. Both are the same preservation rule and must answer the same 409.
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Tienda Principal',
      });
      prismaMock.fiscalDocument.count.mockResolvedValue(0);
      prismaMock.organization.delete.mockRejectedValue(
        foreignKeyRefusal('FiscalDocument_saleId_organizationId_fkey'),
      );

      await expect(
        service.deleteOrganization('org-1', {
          confirmOrganizationName: 'Tienda Principal',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not disguise another restricted relation as a fiscal conflict', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Tienda Principal',
      });
      prismaMock.fiscalDocument.count.mockResolvedValue(0);
      const payrollRefusal = foreignKeyRefusal(
        'PayrollObligation_organizationId_fkey',
      );
      prismaMock.organization.delete.mockRejectedValue(payrollRefusal);

      // Only the fiscal constraint is translated here; any other failure is a
      // real failure and must keep its own diagnosis.
      await expect(
        service.deleteOrganization('org-1', {
          confirmOrganizationName: 'Tienda Principal',
        }),
      ).rejects.toBe(payrollRefusal);
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

  describe('updateElectronicInvoicing', () => {
    /** The exact `data` payload this method sent to `updateMany`. */
    function updatePayload(): Record<string, unknown> {
      const calls = prismaMock.organization.updateMany.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      return calls[0][0].data;
    }

    /** The settings blob this method wrote. */
    function writtenSettings(): Record<string, unknown> {
      return updatePayload().settings as Record<string, unknown>;
    }

    it('records activation without disturbing any other settings key', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        settingsVersion: 4,
        settings: {
          printHeader: 'Mi Negocio',
          downgradeFlags: { usersOverLimit: false },
          custom: { loyalty: 'true' },
        },
      });
      prismaMock.organization.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.updateElectronicInvoicing('org-1', {
        enabled: true,
      });

      expect(prismaMock.organization.updateMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-1', settingsVersion: 4 },
        data: {
          settings: {
            printHeader: 'Mi Negocio',
            downgradeFlags: { usersOverLimit: false },
            custom: { loyalty: 'true' },
            electronicInvoicing: { enabled: true },
          },
          settingsVersion: { increment: 1 },
        },
      });
      expect(result).toEqual({
        organizationId: 'org-1',
        electronicInvoicing: { enabled: true },
      });
      // Differential check against the reader the sale path uses (spec S9):
      // the admin write and `emitFiscalDocumentForSale` must agree on the shape.
      expect(isElectronicInvoicingActive(writtenSettings())).toBe(true);
    });

    it('never creates or updates a fiscal document and records no issuance facts', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        settingsVersion: 0,
        settings: {},
      });
      prismaMock.organization.updateMany.mockResolvedValue({ count: 1 });

      await service.updateElectronicInvoicing('org-1', { enabled: true });

      expect(prismaMock.fiscalDocument.create).not.toHaveBeenCalled();
      expect(prismaMock.fiscalDocument.updateMany).not.toHaveBeenCalled();
      expect(Object.keys(updatePayload()).sort()).toEqual([
        'settings',
        'settingsVersion',
      ]);
      // No CUFE, no invoice number, no fabricated DIAN status may ride along.
      expect(JSON.stringify(updatePayload())).not.toMatch(
        /cufe|invoiceNumber/i,
      );
    });

    it('deactivates the flag and keeps the reader in sync', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        settingsVersion: 2,
        settings: { electronicInvoicing: { enabled: true } },
      });
      prismaMock.organization.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.updateElectronicInvoicing('org-1', {
        enabled: false,
      });

      expect(result.electronicInvoicing.enabled).toBe(false);
      expect(writtenSettings().electronicInvoicing).toEqual({ enabled: false });
      expect(isElectronicInvoicingActive(writtenSettings())).toBe(false);
    });

    it('answers 404 for an unknown organization and writes nothing', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.updateElectronicInvoicing('missing', { enabled: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.organization.updateMany).not.toHaveBeenCalled();
    });

    it('answers 409 when the settings changed concurrently', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        settingsVersion: 7,
        settings: {},
      });
      prismaMock.organization.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateElectronicInvoicing('org-1', { enabled: true }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('starts from an empty blob when the persisted settings are unusable', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        settingsVersion: 0,
        settings: 'not-an-object',
      });
      prismaMock.organization.updateMany.mockResolvedValue({ count: 1 });

      await service.updateElectronicInvoicing('org-1', { enabled: true });

      expect(writtenSettings()).toEqual({
        electronicInvoicing: { enabled: true },
      });
    });

    it('refuses a non-boolean flag before touching the database', async () => {
      await expect(
        service.updateElectronicInvoicing('org-1', {
          // A caller that bypasses the DTO must not activate with a string.
          enabled: 'true' as unknown as boolean,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.organization.updateMany).not.toHaveBeenCalled();
    });
  });
});
