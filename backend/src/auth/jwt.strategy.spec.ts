import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OrgRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: PrismaService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    organizationUser: {
      findFirst: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
  };

  const mockConfigService = {
    getOrThrow: jest.fn().mockReturnValue('test-secret'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    const payload = {
      sub: 'user-1',
      email: 'test@example.com',
      tokenVersion: 1,
      organizationId: 'org-1',
      role: OrgRole.ADMIN,
    };

    it('should throw UnauthorizedException when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(
        new UnauthorizedException('User not found or inactive'),
      );
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        active: false,
        tokenVersion: 1,
      });

      await expect(strategy.validate(payload)).rejects.toThrow(
        new UnauthorizedException('User not found or inactive'),
      );
    });

    it('should throw UnauthorizedException when tokenVersion does not match', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        active: true,
        tokenVersion: 2,
      });

      await expect(strategy.validate(payload)).rejects.toThrow(
        new UnauthorizedException('Token revoked'),
      );
    });

    it('should throw UnauthorizedException when organization membership not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        active: true,
        tokenVersion: 1,
      });
      mockPrisma.organizationUser.findFirst.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(
        new UnauthorizedException('Organization membership not found'),
      );
    });

    it('should return RequestUser when all validations pass', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        active: true,
        tokenVersion: 1,
      });
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        id: 'ou-1',
        userId: 'user-1',
        organizationId: 'org-1',
        role: OrgRole.ADMIN,
      });
      mockPrisma.organization.findUnique.mockResolvedValue({
        status: 'ACTIVE',
      });

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        userId: 'user-1',
        email: 'test@example.com',
        organizationId: 'org-1',
        role: OrgRole.ADMIN,
        tokenVersion: 1,
        isSuperAdmin: false,
        orgStatus: 'ACTIVE',
      });

      expect(mockPrisma.organizationUser.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          organizationId: 'org-1',
        },
      });
    });

    it('should preserve CASHIER role without mapping', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        active: true,
        tokenVersion: 1,
      });
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        id: 'ou-1',
        userId: 'user-1',
        organizationId: 'org-1',
        role: OrgRole.CASHIER,
      });
      mockPrisma.organization.findUnique.mockResolvedValue({
        status: 'ACTIVE',
      });

      const result = await strategy.validate(payload);

      expect(result.role).toBe(OrgRole.CASHIER);
      expect(result.orgStatus).toBe('ACTIVE');
    });

    it('should bypass org lookup for SuperAdmin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-sa',
        email: 'admin@sistema.com',
        active: true,
        tokenVersion: 1,
        isSuperAdmin: true,
      });

      const result = await strategy.validate({
        sub: 'user-sa',
        email: 'admin@sistema.com',
        tokenVersion: 1,
        organizationId: null,
        role: 'SUPER_ADMIN',
      });

      expect(result).toEqual({
        userId: 'user-sa',
        email: 'admin@sistema.com',
        organizationId: undefined,
        role: 'SUPER_ADMIN',
        tokenVersion: 1,
        isSuperAdmin: true,
      });

      expect(mockPrisma.organizationUser.findFirst).not.toHaveBeenCalled();
    });
  });
});
