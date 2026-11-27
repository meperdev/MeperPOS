import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  const prismaMock = {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organizationUser: {
      findFirst: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const planLimitServiceMock = {
    invalidateCache: jest.fn(),
  };

  const authServiceMock = {
    revokeUserTokens: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(
      prismaMock as never,
      planLimitServiceMock as never,
      authServiceMock as never,
    );
  });

  it('creates users without returning password fields', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      active: true,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    });

    const result = await service.create({
      email: 'user@example.com',
      password: 'S3cure-Passphrase-42',
      name: 'User One',
    });

    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'user@example.com',
          name: 'User One',
          password: expect.any(String),
        }),
        select: expect.any(Object),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'user-1',
        email: 'user@example.com',
        name: 'User One',
      }),
    );
    expect(result).not.toHaveProperty('password');
  });

  it('hashes new passwords with the configured bcrypt cost', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-cost',
      email: 'cost@example.com',
      name: 'Cost Check',
      active: true,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    });

    await service.create({
      email: 'cost@example.com',
      password: 'S3cure-Passphrase-42',
      name: 'Cost Check',
    });

    const invocation = prismaMock.user.create.mock.calls[0][0] as {
      data: { password: string };
    };

    // bcrypt embeds the cost factor in the hash prefix ($2a$12$...).
    expect(invocation.data.password).toMatch(/^\$2[aby]\$12\$/);
  });

  it('creates a MEMBER membership from the team screen role list', async () => {
    // S6: the team screen offers Miembro next to Administrador, Cajero and
    // Inventario. MEMBER is a real OrgRole, so the create boundary stores it
    // like any other role and never trips the OWNER guard.
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-member',
      email: 'member@example.com',
      name: 'Member One',
      active: true,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    });

    await service.create(
      {
        email: 'member@example.com',
        password: 'S3cure-Passphrase-42',
        name: 'Member One',
        role: OrgRole.MEMBER,
      },
      'org-1',
      { userId: 'admin-1', role: OrgRole.ADMIN, isSuperAdmin: false },
    );

    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationUsers: {
            create: { organizationId: 'org-1', role: OrgRole.MEMBER },
          },
        }),
      }),
    );
  });

  it('rejects duplicate emails on update', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'old@example.com',
      active: true,
    });
    prismaMock.user.findFirst.mockResolvedValue({ id: 'user-3' });

    await expect(
      service.update('admin-1', 'user-2', { email: 'taken@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns audit context with meaningful field-level summary on update', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'old@example.com',
      name: 'Old Name',
      active: true,
    });
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
      name: 'New Name',
      active: true,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T01:00:00.000Z'),
    });

    const result = await service.update('admin-1', 'user-2', {
      email: 'new@example.com',
      name: 'New Name',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'user-2',
        email: 'new@example.com',
        name: 'New Name',
      }),
    );
    expect(Object.getOwnPropertyDescriptor(result, '__auditContext')).toEqual(
      expect.objectContaining({
        enumerable: false,
        value: expect.objectContaining({
          resourceId: 'user-2',
          summary: expect.stringContaining('name, email'),
          metadata: expect.objectContaining({
            changedFields: ['name', 'email'],
          }),
        }),
      }),
    );
  });

  it('prevents admins from deactivating themselves', async () => {
    await expect(
      service.toggleActive('admin-1', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('prevents admins from deleting themselves', async () => {
    await expect(service.remove('admin-1', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('returns audit context with the deleted user id', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      active: true,
    });
    prismaMock.user.delete.mockResolvedValue({ id: 'user-2' });

    const result = await service.remove('admin-1', 'user-2');

    expect(result).toEqual({ message: 'User deleted successfully' });
    expect(Object.getOwnPropertyDescriptor(result, '__auditContext')).toEqual(
      expect.objectContaining({
        enumerable: false,
        value: expect.objectContaining({
          resourceId: 'user-2',
          summary: 'Deleted user User Two (user2@example.com)',
        }),
      }),
    );
  });

  it('resets passwords from the users boundary and attaches the audit context', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      userId: 'user-2',
      organizationId: 'org-1',
    });
    prismaMock.organizationUser.count.mockResolvedValue(1);
    prismaMock.user.update.mockResolvedValue({ id: 'user-2' });

    const result = await service.resetPassword(
      'admin-1',
      'user-2',
      {
        newPassword: 'NuevaClaveSegura123',
      },
      'org-1',
    );

    expect(result).toEqual({ message: 'Contraseña restablecida exitosamente' });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: { password: expect.any(String) },
    });
    // Credential hygiene: the reset revokes the target's active sessions.
    expect(authServiceMock.revokeUserTokens).toHaveBeenCalledWith('user-2');
    // The audit row is written by AuditInterceptor from this attached
    // context; the service must not write it manually anymore.
    expect((result as { __auditContext?: unknown }).__auditContext).toEqual({
      resource: 'User',
      resourceId: 'user-2',
      summary: 'Reset password for user User Two (user2@example.com)',
      metadata: {
        targetUserId: 'user-2',
        targetUserEmail: 'user2@example.com',
        targetUserName: 'User Two',
      },
    });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('filters findAll by organizationId when provided', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);

    await service.findAll('org-1');

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationUsers: {
            some: { organizationId: 'org-1' },
          },
        },
      }),
    );
  });

  it('throws ForbiddenException when updating a user outside the organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue(null);

    await expect(
      service.update('admin-1', 'user-2', { name: 'Hacked' }, 'org-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to update a multi-org user and leaves the global row untouched', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'shared-user',
      email: 'shared@example.com',
      name: 'Shared User',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      userId: 'shared-user',
      organizationId: 'org-1',
    });
    // The target belongs to two organizations: org admins must not mutate
    // the global identity other organizations share.
    prismaMock.organizationUser.count.mockResolvedValue(2);

    await expect(
      service.update('admin-1', 'shared-user', { name: 'Mutated' }, 'org-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('refuses to reset the password of a multi-org user without revoking anything', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'shared-user',
      email: 'shared@example.com',
      name: 'Shared User',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      userId: 'shared-user',
      organizationId: 'org-1',
    });
    prismaMock.organizationUser.count.mockResolvedValue(2);

    await expect(
      service.resetPassword(
        'admin-1',
        'shared-user',
        { newPassword: 'NuevaClaveSegura123' },
        'org-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(authServiceMock.revokeUserTokens).not.toHaveBeenCalled();
  });

  it('refuses to toggle a multi-org user active flag', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'shared-user',
      email: 'shared@example.com',
      name: 'Shared User',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      userId: 'shared-user',
      organizationId: 'org-1',
    });
    prismaMock.organizationUser.count.mockResolvedValue(2);

    await expect(
      service.toggleActive('admin-1', 'shared-user', 'org-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('prevents removing the primary owner', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      userId: 'user-2',
      organizationId: 'org-1',
      role: 'ADMIN',
      isPrimaryOwner: true,
    });

    await expect(
      service.remove('admin-1', 'user-2', 'org-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
    expect(prismaMock.organizationUser.delete).not.toHaveBeenCalled();
  });

  it('prevents removing the last admin of an organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      userId: 'user-2',
      organizationId: 'org-1',
      role: 'ADMIN',
      isPrimaryOwner: false,
    });
    prismaMock.organizationUser.count.mockResolvedValue(1);

    await expect(
      service.remove('admin-1', 'user-2', 'org-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
    expect(prismaMock.organizationUser.delete).not.toHaveBeenCalled();
  });

  it('lets an ordinary admin go while the primary owner, now an ADMIN, remains', async () => {
    // OWNER is retired: the primary owner is an ADMIN membership, so it counts
    // toward "an organization keeps an admin". The old OWNER + one ADMIN case
    // refused this removal only because the OWNER was not counted.
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-2',
      userId: 'user-2',
      organizationId: 'org-1',
      role: 'ADMIN',
      isPrimaryOwner: false,
    });
    prismaMock.organizationUser.delete.mockResolvedValue({ id: 'ou-2' });
    prismaMock.organizationUser.count.mockImplementation(
      async ({ where }: { where: { role?: string } }) =>
        where.role === 'ADMIN' ? 2 : 1,
    );

    const result = await service.remove('owner-1', 'user-2', 'org-1');

    expect(prismaMock.organizationUser.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', role: 'ADMIN' },
    });
    expect(prismaMock.organizationUser.delete).toHaveBeenCalledWith({
      where: { id: 'ou-2' },
    });
    expect(result).toEqual({ message: 'User removed from organization' });
  });

  it('removes only the membership when the user belongs to another organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'shared@example.com',
      name: 'Shared User',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      userId: 'user-2',
      organizationId: 'org-1',
      role: 'MEMBER',
      isPrimaryOwner: false,
    });
    prismaMock.organizationUser.delete.mockResolvedValue({ id: 'ou-1' });
    // One membership remains in the other organization.
    prismaMock.organizationUser.count.mockResolvedValue(1);

    const result = await service.remove('admin-1', 'user-2', 'org-1');

    expect(prismaMock.organizationUser.delete).toHaveBeenCalledWith({
      where: { id: 'ou-1' },
    });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ message: 'User removed from organization' });
  });

  it('hard-deletes the global account when removing the last membership', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'solo@example.com',
      name: 'Solo User',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      userId: 'user-2',
      organizationId: 'org-1',
      role: 'CASHIER',
      isPrimaryOwner: false,
    });
    prismaMock.organizationUser.delete.mockResolvedValue({ id: 'ou-1' });
    prismaMock.organizationUser.count.mockResolvedValue(0);
    prismaMock.user.delete.mockResolvedValue({ id: 'user-2' });

    const result = await service.remove('admin-1', 'user-2', 'org-1');

    expect(prismaMock.organizationUser.delete).toHaveBeenCalledWith({
      where: { id: 'ou-1' },
    });
    expect(prismaMock.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-2' },
    });
    expect(result).toEqual({ message: 'User deleted successfully' });
  });

  it('allows removing an admin when there are other admins', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      userId: 'user-2',
      organizationId: 'org-1',
      role: 'ADMIN',
      isPrimaryOwner: false,
    });
    // Admin-count query sees other admins; membership count shows this is
    // the user's only membership, so the global account is removed too.
    prismaMock.organizationUser.count.mockImplementation(async ({ where }) =>
      'role' in where ? 2 : 0,
    );
    prismaMock.organizationUser.delete.mockResolvedValue({ id: 'ou-1' });
    prismaMock.user.delete.mockResolvedValue({ id: 'user-2' });

    const result = await service.remove('admin-1', 'user-2', 'org-1');

    expect(result).toEqual({ message: 'User deleted successfully' });
    expect(prismaMock.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-2' },
    });
  });

  describe('role assignment at creation (S8 b)', () => {
    const createDto = {
      email: 'new@example.com',
      password: 'S3cure-Passphrase-42',
      name: 'New User',
    };
    const createdUser = {
      id: 'user-new',
      email: 'new@example.com',
      name: 'New User',
      active: true,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    };

    it('refuses the retired OWNER role even for a SUPER_ADMIN', async () => {
      await expect(
        service.create({ ...createDto, role: OrgRole.OWNER }, 'org-1', {
          userId: 'super-1',
          role: 'SUPER_ADMIN',
          isSuperAdmin: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('refuses an ADMIN who is not the primary owner creating an ADMIN', async () => {
      prismaMock.organizationUser.findFirst.mockResolvedValue({
        isPrimaryOwner: false,
      });

      await expect(
        service.create({ ...createDto, role: OrgRole.ADMIN }, 'org-1', {
          userId: 'admin-1',
          role: OrgRole.ADMIN,
          isSuperAdmin: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.organizationUser.findFirst).toHaveBeenCalledWith({
        where: { userId: 'admin-1', organizationId: 'org-1' },
        select: { isPrimaryOwner: true },
      });
      // Refused before any account work: no email check, no insert.
      expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('lets the organization primary owner create an ADMIN', async () => {
      prismaMock.organizationUser.findFirst.mockResolvedValue({
        isPrimaryOwner: true,
      });
      prismaMock.user.findFirst.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(createdUser);

      await service.create({ ...createDto, role: OrgRole.ADMIN }, 'org-1', {
        userId: 'owner-1',
        role: OrgRole.ADMIN,
        isSuperAdmin: false,
      });

      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationUsers: {
              create: { organizationId: 'org-1', role: OrgRole.ADMIN },
            },
          }),
        }),
      );
    });

    it('still lets a non-primary ADMIN create a CASHIER', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(createdUser);

      await service.create({ ...createDto, role: OrgRole.CASHIER }, 'org-1', {
        userId: 'admin-1',
        role: OrgRole.ADMIN,
        isSuperAdmin: false,
      });

      expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationUsers: {
              create: { organizationId: 'org-1', role: OrgRole.CASHIER },
            },
          }),
        }),
      );
    });
  });

  describe('primary owner password protection (S8 c)', () => {
    const membership = (
      userId: string,
      isPrimaryOwner: boolean,
      role: string = 'ADMIN',
    ) => ({
      id: `ou-${userId}`,
      userId,
      organizationId: 'org-1',
      role,
      isPrimaryOwner,
    });

    function mockTargetAndActor(
      targetUserId: string,
      targetIsPrimaryOwner: boolean,
      actorIsPrimaryOwner: boolean,
      targetRole: string = 'ADMIN',
    ) {
      prismaMock.user.findUnique.mockResolvedValue({
        id: targetUserId,
        email: 'target@example.com',
        name: 'Target User',
        active: true,
      });
      prismaMock.organizationUser.count.mockResolvedValue(1);
      prismaMock.user.update.mockResolvedValue({ id: targetUserId });
      prismaMock.organizationUser.findFirst.mockImplementation(
        (args: unknown) => {
          const { where } = args as { where: { userId: string } };
          return Promise.resolve(
            where.userId === 'admin-1'
              ? membership('admin-1', actorIsPrimaryOwner)
              : membership(targetUserId, targetIsPrimaryOwner, targetRole),
          );
        },
      );
    }

    it('refuses an ADMIN resetting the password of the primary owner', async () => {
      mockTargetAndActor('owner-1', true, false);

      await expect(
        service.resetPassword(
          'admin-1',
          'owner-1',
          { newPassword: 'NuevaClaveSegura123' },
          'org-1',
          { userId: 'admin-1', role: OrgRole.ADMIN, isSuperAdmin: false },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(authServiceMock.revokeUserTokens).not.toHaveBeenCalled();
    });

    it('lets the primary owner reset the primary owner password', async () => {
      mockTargetAndActor('owner-1', true, true);

      const result = await service.resetPassword(
        'owner-1',
        'owner-1',
        { newPassword: 'NuevaClaveSegura123' },
        'org-1',
        { userId: 'owner-1', role: OrgRole.ADMIN, isSuperAdmin: false },
      );

      expect(result).toEqual({
        message: 'Contraseña restablecida exitosamente',
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'owner-1' },
        data: { password: expect.any(String) },
      });
    });

    it('refuses an ordinary ADMIN resetting another ADMIN password', async () => {
      // An admin account is the top organization role: taking one over is the
      // same escalation as minting one, so only the primary owner (or a
      // SUPER_ADMIN) may reset it. This also covers former OWNER memberships
      // that the migration turned into unflagged ADMINs.
      mockTargetAndActor('admin-2', false, false);

      await expect(
        service.resetPassword(
          'admin-1',
          'admin-2',
          { newPassword: 'NuevaClaveSegura123' },
          'org-1',
          { userId: 'admin-1', role: OrgRole.ADMIN, isSuperAdmin: false },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('lets the primary owner reset another ADMIN password', async () => {
      mockTargetAndActor('admin-2', false, true);

      await service.resetPassword(
        'admin-1',
        'admin-2',
        { newPassword: 'NuevaClaveSegura123' },
        'org-1',
        { userId: 'admin-1', role: OrgRole.ADMIN, isSuperAdmin: false },
      );

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'admin-2' },
        data: { password: expect.any(String) },
      });
    });

    it('still lets an ordinary ADMIN reset their own password', async () => {
      mockTargetAndActor('admin-1', false, false);

      await service.resetPassword(
        'admin-1',
        'admin-1',
        { newPassword: 'NuevaClaveSegura123' },
        'org-1',
        { userId: 'admin-1', role: OrgRole.ADMIN, isSuperAdmin: false },
      );

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { password: expect.any(String) },
      });
    });

    it('still lets an ordinary ADMIN reset a cashier password', async () => {
      mockTargetAndActor('cashier-2', false, false, 'CASHIER');

      await service.resetPassword(
        'admin-1',
        'cashier-2',
        { newPassword: 'NuevaClaveSegura123' },
        'org-1',
        { userId: 'admin-1', role: OrgRole.ADMIN, isSuperAdmin: false },
      );

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'cashier-2' },
        data: { password: expect.any(String) },
      });
    });

    it('still lets a SUPER_ADMIN reset the primary owner password', async () => {
      mockTargetAndActor('owner-1', true, false);

      await service.resetPassword(
        'super-1',
        'owner-1',
        { newPassword: 'NuevaClaveSegura123' },
        'org-1',
        { userId: 'super-1', role: 'SUPER_ADMIN', isSuperAdmin: true },
      );

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'owner-1' },
        data: { password: expect.any(String) },
      });
    });

    describe('editing and deactivating admin-rank accounts', () => {
      const ordinaryAdmin = {
        userId: 'admin-1',
        role: OrgRole.ADMIN,
        isSuperAdmin: false,
      };

      it.each([
        ['the primary owner', 'owner-1', true],
        ['another ADMIN', 'admin-2', false],
      ] as const)(
        'refuses an ordinary ADMIN editing %s',
        async (_label, target, targetIsPrimaryOwner) => {
          mockTargetAndActor(target, targetIsPrimaryOwner, false);

          await expect(
            service.update(
              'admin-1',
              target,
              { name: 'Renamed' },
              'org-1',
              ordinaryAdmin,
            ),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(prismaMock.user.update).not.toHaveBeenCalled();
        },
      );

      it.each([
        ['the primary owner', 'owner-1', true],
        ['another ADMIN', 'admin-2', false],
      ] as const)(
        'refuses an ordinary ADMIN deactivating %s',
        async (_label, target, targetIsPrimaryOwner) => {
          mockTargetAndActor(target, targetIsPrimaryOwner, false);

          await expect(
            service.toggleActive('admin-1', target, 'org-1', ordinaryAdmin),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(prismaMock.user.update).not.toHaveBeenCalled();
        },
      );

      it('lets the primary owner edit and deactivate another ADMIN', async () => {
        mockTargetAndActor('admin-2', false, true);

        await service.update(
          'admin-1',
          'admin-2',
          { name: 'Renamed' },
          'org-1',
          ordinaryAdmin,
        );
        await service.toggleActive(
          'admin-1',
          'admin-2',
          'org-1',
          ordinaryAdmin,
        );

        expect(prismaMock.user.update).toHaveBeenCalledTimes(2);
      });

      it('lets a SUPER_ADMIN deactivate the primary owner', async () => {
        mockTargetAndActor('owner-1', true, false);

        await service.toggleActive('super-1', 'owner-1', 'org-1', {
          userId: 'super-1',
          role: 'SUPER_ADMIN',
          isSuperAdmin: true,
        });

        expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
      });

      it.each([
        ['a missing actor', undefined],
        ['an ordinary ADMIN', ordinaryAdmin],
      ] as const)(
        'protects a leftover OWNER without the flag from %s',
        async (_label, actor) => {
          mockTargetAndActor('legacy-1', false, false, 'OWNER');

          await expect(
            service.update(
              'admin-1',
              'legacy-1',
              { name: 'Edited' },
              'org-1',
              actor,
            ),
          ).rejects.toBeInstanceOf(ForbiddenException);
          await expect(
            service.toggleActive('admin-1', 'legacy-1', 'org-1', actor),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(prismaMock.user.update).not.toHaveBeenCalled();
        },
      );

      it('still lets an ordinary ADMIN edit their own name', async () => {
        mockTargetAndActor('admin-1', false, false);

        await service.update(
          'admin-1',
          'admin-1',
          { name: 'Me' },
          'org-1',
          ordinaryAdmin,
        );

        expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
      });

      it('still lets an ordinary ADMIN edit and deactivate a cashier', async () => {
        mockTargetAndActor('cashier-2', false, false, 'CASHIER');

        await service.update(
          'admin-1',
          'cashier-2',
          { name: 'Caja' },
          'org-1',
          ordinaryAdmin,
        );
        await service.toggleActive(
          'admin-1',
          'cashier-2',
          'org-1',
          ordinaryAdmin,
        );

        expect(prismaMock.user.update).toHaveBeenCalledTimes(2);
      });
    });
  });
});
