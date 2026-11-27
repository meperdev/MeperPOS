import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { AdminModuleCatalogController } from './admin-module-catalog.controller';
import { BusinessModulesService } from './business-modules.service';

// S3/S8: exercise signed tokens through the actual Passport/JWT boundary.
describe('T10a independent signed-token catalog boundary', () => {
  const secret = 't10a-public-verification-only';
  const jwt = new JwtService({ secret });
  const catalog = [
    {
      id: 'vehicles',
      name: 'Vehículos',
      description: 'Placas, modelos y vehículos asociados a cada cliente.',
    },
  ];
  const prisma = {
    user: { findUnique: jest.fn() },
    organizationUser: { findFirst: jest.fn() },
    organization: { findUnique: jest.fn() },
    organizationModule: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
  let app: INestApplication;
  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [AdminModuleCatalogController],
      providers: [
        BusinessModulesService,
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: secret }),
        },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u',
      active: true,
      tokenVersion: 0,
      isSuperAdmin: false,
    });
  });
  afterEach(() => {
    for (const fn of Object.values(prisma.organizationModule))
      expect(fn).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    await app.close();
  });
  const token = (
    role: string,
    organizationId: string | null = null,
    extra = {},
  ) =>
    jwt.sign({
      sub: 'u',
      email: 'u@example.test',
      tokenVersion: 0,
      role,
      organizationId,
      ...extra,
    });
  const get = (authorization?: string) => {
    const req = request(app.getHttpServer()).get('/api/admin/modules');
    return authorization ? req.set('Authorization', authorization) : req;
  };
  it.each([null, 'org-a'])(
    'serves SuperAdmin with scope %s without tenant queries',
    async (scope) => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u',
        active: true,
        tokenVersion: 0,
        isSuperAdmin: true,
      });
      const response = await get('Bearer ' + token('SUPER_ADMIN', scope));
      expect(response.status).toBe(200);
      expect(response.body).toEqual(catalog);
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.organizationUser.findFirst).not.toHaveBeenCalled();
    },
  );
  it.each(['ADMIN', 'CASHIER', 'INVENTORY_USER'])(
    'denies persisted %s even when the token claims a stale role',
    async (role) => {
      prisma.organizationUser.findFirst.mockResolvedValue({
        organizationId: 'org-a',
        role,
      });
      prisma.organization.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      const response = await get('Bearer ' + token('OWNER', 'org-a'));
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Access denied. Required roles: SUPER_ADMIN',
      });
    },
  );
  it.each([
    undefined,
    'Bearer malformed',
    'Bearer ' + jwt.sign({ sub: 'u' }, { expiresIn: -1 }),
  ])(
    'denies absent, malformed or expired credentials: %s',
    async (authorization) => {
      const response = await get(authorization);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
    },
  );
  it('denies a revoked SuperAdmin token', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u',
      active: true,
      tokenVersion: 1,
      isSuperAdmin: true,
    });
    const response = await get('Bearer ' + token('SUPER_ADMIN'));
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Token revoked',
    });
  });
  it('returns defensive definitions, not mutable catalog references', () => {
    const service = new BusinessModulesService(prisma as never);
    const first = service.listCatalog();
    first[0].name = 'Changed';
    first.push({ id: 'payroll', name: 'Payroll', description: '' });
    expect(service.listCatalog()).toEqual(catalog);
  });
});
