import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { OrgRole, OrgStatus, PlanType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    organizationUser: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-access-token'),
    verify: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashed-password',
      tokenVersion: 1,
      active: true,
      isSuperAdmin: false,
    };

    const mockSuperAdmin = {
      id: 'user-sa',
      email: 'admin@sistema.com',
      name: 'Super Admin',
      password: 'hashed-password',
      tokenVersion: 1,
      active: true,
      isSuperAdmin: true,
    };

    const mockOrgUser = {
      id: 'ou-1',
      userId: 'user-1',
      organizationId: 'org-1',
      role: OrgRole.ADMIN,
      joinedAt: new Date(),
    };

    it('should throw UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        active: false,
      });

      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('should throw UnauthorizedException when password is invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('should throw UnauthorizedException when organizationId provided but membership not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.organizationUser.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ ...loginDto, organizationId: 'org-1' }),
      ).rejects.toThrow(
        new UnauthorizedException('Organization membership not found'),
      );
    });

    it('should throw UnauthorizedException when user has no organizations', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);

      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('User has no organizations'),
      );
    });

    it('should return requiresOrganizationSelection when user has 2+ organizations', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        {
          ...mockOrgUser,
          organization: {
            id: 'org-1',
            name: 'Org One',
            plan: PlanType.BASIC,
            status: 'ACTIVE',
          },
        },
        {
          id: 'ou-2',
          userId: 'user-1',
          organizationId: 'org-2',
          role: OrgRole.MEMBER,
          joinedAt: new Date(),
          organization: {
            id: 'org-2',
            name: 'Org Two',
            plan: PlanType.PRO,
            status: 'ACTIVE',
          },
        },
      ]);
      mockJwtService.sign.mockReturnValueOnce('mock-pre-auth-token');

      const result = await service.login(loginDto);

      expect(result).toEqual({
        requiresOrganizationSelection: true,
        preAuthToken: 'mock-pre-auth-token',
        organizations: [
          {
            id: 'org-1',
            name: 'Org One',
            role: OrgRole.ADMIN,
            plan: PlanType.BASIC,
          },
          {
            id: 'org-2',
            name: 'Org Two',
            role: OrgRole.MEMBER,
            plan: PlanType.PRO,
          },
        ],
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        {
          sub: 'user-1',
          email: 'test@example.com',
          type: 'pre-auth',
        },
        { expiresIn: '5m' },
      );
    });

    it('should login successfully with provided organizationId', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.organizationUser.findFirst.mockResolvedValue(mockOrgUser);
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: PlanType.BASIC,
        status: 'ACTIVE',
        trialEndsAt: null,
        billingStatus: 'PAID',
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result: any = await service.login({
        ...loginDto,
        organizationId: 'org-1',
      });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        organizationId: 'org-1',
        role: OrgRole.ADMIN,
        organization: {
          id: 'org-1',
          plan: PlanType.BASIC,
          status: 'ACTIVE',
          trialEndsAt: null,
          billingStatus: 'PAID',
        },
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          email: 'test@example.com',
          organizationId: 'org-1',
          role: OrgRole.ADMIN,
          tokenVersion: 1,
        }),
        { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      );
    });

    it('should login successfully using first organization when none provided and user has 1 org', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        {
          ...mockOrgUser,
          organization: {
            id: 'org-1',
            name: 'Org One',
            plan: PlanType.BASIC,
            status: 'ACTIVE',
          },
        },
      ]);
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result: any = await service.login(loginDto);

      expect(result.user.organizationId).toBe('org-1');
      expect(mockPrisma.organizationUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { joinedAt: 'asc' },
        }),
      );
    });

    it('should pass ipAddress and userAgent to refresh token creation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.organizationUser.findFirst.mockResolvedValue(mockOrgUser);
      mockPrisma.organization.findUnique.mockResolvedValue({
        status: 'ACTIVE',
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      await service.login(loginDto, '127.0.0.1', 'Mozilla/5.0');

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ipAddress: '127.0.0.1',
            userAgent: 'Mozilla/5.0',
          }),
        }),
      );
    });

    it('should login SuperAdmin without requiring OrganizationUser', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockSuperAdmin);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result: any = await service.login({
        email: 'admin@sistema.com',
        password: 'admin123',
      });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.user.organizationId).toBeNull();
      expect(result.user.role).toBe('SUPER_ADMIN');
      expect(mockPrisma.organizationUser.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('selectOrganization', () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashed-password',
      tokenVersion: 1,
      active: true,
      isSuperAdmin: false,
    };

    const mockOrgUser = {
      id: 'ou-1',
      userId: 'user-1',
      organizationId: 'org-1',
      role: OrgRole.ADMIN,
      joinedAt: new Date(),
    };

    it('should validate preAuthToken and return final JWT', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@example.com',
        type: 'pre-auth',
      });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.organizationUser.findFirst.mockResolvedValue(mockOrgUser);
      mockPrisma.organization.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        name: 'Org One',
        plan: PlanType.BASIC,
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.selectOrganization('valid-token', 'org-1');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.user.organizationId).toBe('org-1');
      expect(mockJwtService.verify).toHaveBeenCalledWith('valid-token');
    });

    it('should throw UnauthorizedException with invalid preAuthToken', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      await expect(
        service.selectOrganization('invalid-token', 'org-1'),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid pre-authentication token'),
      );
    });

    it('should throw UnauthorizedException when user does not belong to organization', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@example.com',
        type: 'pre-auth',
      });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.organizationUser.findFirst.mockResolvedValue(null);

      await expect(
        service.selectOrganization('valid-token', 'org-2'),
      ).rejects.toThrow(
        new UnauthorizedException('Organization membership not found'),
      );
    });

    it('should throw ForbiddenException when organization is suspended', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@example.com',
        type: 'pre-auth',
      });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.organizationUser.findFirst.mockResolvedValue(mockOrgUser);
      mockPrisma.organization.findUnique.mockResolvedValue({
        status: 'SUSPENDED',
        name: 'Org One',
        plan: PlanType.BASIC,
      });

      await expect(
        service.selectOrganization('valid-token', 'org-1'),
      ).rejects.toThrow(new ForbiddenException('Organization is suspended'));
    });

    it('should throw UnauthorizedException when preAuthToken type is not pre-auth', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@example.com',
        type: 'access',
      });

      await expect(
        service.selectOrganization('valid-token', 'org-1'),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid pre-authentication token'),
      );
    });
  });

  describe('getUserOrganizations', () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashed-password',
      tokenVersion: 1,
      active: true,
      isSuperAdmin: false,
    };

    it('should return all organizations the user belongs to', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        {
          id: 'ou-1',
          userId: 'user-1',
          organizationId: 'org-1',
          role: OrgRole.ADMIN,
          joinedAt: new Date(),
          organization: {
            id: 'org-1',
            name: 'Org One',
            plan: PlanType.BASIC,
            status: OrgStatus.ACTIVE,
          },
        },
        {
          id: 'ou-2',
          userId: 'user-1',
          organizationId: 'org-2',
          role: OrgRole.MEMBER,
          joinedAt: new Date(),
          organization: {
            id: 'org-2',
            name: 'Org Two',
            plan: PlanType.PRO,
            status: OrgStatus.TRIAL,
          },
        },
      ]);

      const result = await service.getUserOrganizations('user-1');

      expect(result).toEqual({
        organizations: [
          {
            id: 'org-1',
            name: 'Org One',
            role: OrgRole.ADMIN,
            plan: PlanType.BASIC,
            status: OrgStatus.ACTIVE,
          },
          {
            id: 'org-2',
            name: 'Org Two',
            role: OrgRole.MEMBER,
            plan: PlanType.PRO,
            status: OrgStatus.TRIAL,
          },
        ],
      });
      expect(mockPrisma.organizationUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          include: { organization: true },
        }),
      );
    });

    it('should exclude organizations the user does not belong to', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        {
          id: 'ou-1',
          userId: 'user-1',
          organizationId: 'org-1',
          role: OrgRole.ADMIN,
          joinedAt: new Date(),
          organization: {
            id: 'org-1',
            name: 'Org One',
            plan: PlanType.BASIC,
            status: OrgStatus.ACTIVE,
          },
        },
      ]);

      const result = await service.getUserOrganizations('user-1');

      expect(result.organizations).toHaveLength(1);
      expect(result.organizations[0].id).toBe('org-1');
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getUserOrganizations('missing-user'),
      ).rejects.toThrow(
        new UnauthorizedException('User not found or inactive'),
      );
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        active: false,
      });

      await expect(service.getUserOrganizations('user-1')).rejects.toThrow(
        new UnauthorizedException('User not found or inactive'),
      );
    });

    it('should return empty organizations list when user has no organizations', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);

      const result = await service.getUserOrganizations('user-1');

      expect(result).toEqual({ organizations: [] });
    });
  });

  describe('selectOrg', () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashed-password',
      tokenVersion: 1,
      active: true,
      isSuperAdmin: false,
    };

    const mockOrgUser = {
      id: 'ou-1',
      userId: 'user-1',
      organizationId: 'org-1',
      role: OrgRole.ADMIN,
      joinedAt: new Date(),
    };

    it('should reject switch to organization the user does not belong to', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.organizationUser.findFirst.mockResolvedValue(null);

      await expect(service.selectOrg('user-1', 'foreign-org')).rejects.toThrow(
        new UnauthorizedException('Organization membership not found'),
      );
    });

    it('should reject switch to suspended organization', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.organizationUser.findFirst.mockResolvedValue(mockOrgUser);
      mockPrisma.organization.findUnique.mockResolvedValue({
        status: OrgStatus.SUSPENDED,
      });

      await expect(service.selectOrg('user-1', 'org-1')).rejects.toThrow(
        new UnauthorizedException('Organization is suspended'),
      );
    });

    it('should revoke prior refresh tokens on successful switch', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.organizationUser.findFirst.mockResolvedValue(mockOrgUser);
      mockPrisma.organization.findUnique.mockResolvedValue({
        status: OrgStatus.ACTIVE,
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        tokenVersion: 2,
      });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.selectOrg('user-1', 'org-1');

      expect(result.accessToken).toBe('mock-access-token');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { tokenVersion: { increment: 1 } },
        }),
      );
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
          data: {
            revokedAt: expect.any(Date),
            revocationCause: 'revoke-all',
          },
        }),
      );
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          tokenVersion: 2,
        }),
        { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      );
    });
  });

  describe('logout (issue #48 slice C1)', () => {
    it('revokes the refresh token matching the sha256 of the raw value', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('raw-logout-token');

      const expectedHash = createHash('sha256')
        .update('raw-logout-token')
        .digest('hex');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { token: expectedHash, revokedAt: null },
        data: {
          revokedAt: expect.any(Date),
          revocationCause: 'logout',
        },
      });
    });

    it('is a no-op without a token (cookie-less logout still succeeds)', async () => {
      await service.logout(undefined);
      await service.logout(null);

      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('does not throw when the token is unknown or already revoked', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.logout('unknown-token')).resolves.toBeUndefined();
    });
  });

  describe('changePassword (session revocation)', () => {
    const dto = {
      currentPassword: 'ClaveActual1',
      newPassword: 'NuevaClaveSegura123',
    };
    const existingUser = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      password: 'old-hash',
      tokenVersion: 1,
      active: true,
      isSuperAdmin: false,
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(existingUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      mockPrisma.user.update
        // 1) the password write
        .mockResolvedValueOnce({ ...existingUser, password: 'new-hash' })
        // 2) the tokenVersion bump performed by revokeUserTokens
        .mockResolvedValueOnce({ ...existingUser, tokenVersion: 2 });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'refresh-1' });
    });

    it('persists the new password, revokes every session, and re-issues the caller session', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-1',
        role: OrgRole.ADMIN,
      });

      const result = await service.changePassword('user-1', dto, {
        organizationId: 'org-1',
        role: OrgRole.ADMIN,
      });

      expect(bcrypt.hash).toHaveBeenCalledWith(
        dto.newPassword,
        expect.any(Number),
      );
      expect(mockPrisma.user.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'user-1' },
        data: { password: 'new-hash' },
      });

      // Every session dies: access JWTs via tokenVersion, refresh rows revoked.
      expect(mockPrisma.user.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'user-1' },
        data: { tokenVersion: { increment: 1 } },
      });
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: {
          revokedAt: expect.any(Date),
          revocationCause: 'revoke-all',
        },
      });

      // The replacement pair carries the bumped tokenVersion, so the stolen
      // access token stays dead instead of being silently resurrected.
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ tokenVersion: 2 }),
        expect.anything(),
      );
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        message: 'Password changed successfully',
      });
      expect(result).toHaveProperty('accessToken');
    });

    it('re-issues the membership role from the database, never from the claim', async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-1',
        role: OrgRole.MEMBER,
      });

      await service.changePassword('user-1', dto, {
        organizationId: 'org-1',
        // A tampered/stale claim claiming ADMIN must not reach the new token.
        role: OrgRole.OWNER,
      });

      expect(mockPrisma.organizationUser.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', organizationId: 'org-1' },
      });
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: OrgRole.MEMBER }),
        expect.anything(),
      );
    });

    it('re-issues a SUPER_ADMIN session without an organization', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...existingUser,
        isSuperAdmin: true,
      });

      const result = await service.changePassword('user-1', dto, {
        organizationId: null,
        role: 'SUPER_ADMIN',
      });

      expect(mockPrisma.organizationUser.findFirst).not.toHaveBeenCalled();
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'SUPER_ADMIN', organizationId: null }),
        expect.anything(),
      );
      expect(result).toHaveProperty('accessToken');
    });

    it('still revokes every session when there is no org context to re-issue', async () => {
      const result = await service.changePassword('user-1', dto, {
        organizationId: null,
        role: OrgRole.ADMIN,
      });

      expect(mockPrisma.user.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'user-1' },
        data: { tokenVersion: { increment: 1 } },
      });
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
      expect(result).toEqual({ message: 'Password changed successfully' });
    });

    it('rejects a wrong current password without touching the password or the sessions', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', dto, {
          organizationId: 'org-1',
          role: OrgRole.ADMIN,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });
});
