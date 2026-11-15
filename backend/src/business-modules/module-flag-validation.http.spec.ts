import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp, configureErrorHandling } from '../app-configuration';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PUBLIC_ERROR_CODES } from '../common/errors/public-error.model';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { AdminBusinessModulesController } from './admin-business-modules.controller';
import { BusinessModulesController } from './business-modules.controller';
import { BusinessModulesService } from './business-modules.service';

/**
 * S1/S3: a module flag is a JSON boolean and nothing else.
 *
 * `main.ts` boots `configureApp` + `configureErrorHandling`; the latter enables
 * `enableImplicitConversion`, so class-transformer runs `Boolean(value)` before
 * class-validator sees a body field. A body such as `{ "enabled": "false" }`
 * would therefore become `true` and enable the module instead of failing.
 * This spec boots the real controller with the production validation/error
 * wiring, the real JwtStrategy/JwtAuthGuard/RolesGuard and signed tokens,
 * keeping Prisma as an in-memory fixture: no database and no live server.
 */
const SECRET = 'module-flag-public-fixture-signing-value';
const ORGANIZATION_ID = 'org-flag';
const ROUTE = `/api/admin/organizations/${ORGANIZATION_ID}/modules/vehicles`;
const VALIDATION_MESSAGE = 'enabled: enabled must be a boolean value';
const VEHICLES = {
  id: 'vehicles',
  name: 'Vehículos',
  description: 'Placas, modelos y vehículos asociados a cada cliente.',
};

interface UserRecord {
  id: string;
  active: boolean;
  tokenVersion: number;
  isSuperAdmin: boolean;
}

interface MembershipRecord {
  userId: string;
  organizationId: string;
  role: string;
}

interface ModuleRow {
  organizationId: string;
  module: string;
  enabled: boolean;
}

interface UpsertArgs {
  where: { organizationId_module: { organizationId: string; module: string } };
  create: { organizationId: string; module: string; enabled: boolean };
  update: { enabled: boolean };
}

/** Ledger + store the service reads and writes, with write counters. */
function createPrismaFixture() {
  const users = new Map<string, UserRecord>([
    [
      'user-super',
      {
        id: 'user-super',
        active: true,
        tokenVersion: 0,
        isSuperAdmin: true,
      },
    ],
    [
      'user-admin',
      {
        id: 'user-admin',
        active: true,
        tokenVersion: 0,
        isSuperAdmin: false,
      },
    ],
  ]);
  const memberships: MembershipRecord[] = [
    { userId: 'user-admin', organizationId: ORGANIZATION_ID, role: 'ADMIN' },
  ];
  const rows = new Map<string, ModuleRow>();
  const writes = { upsert: 0 };
  const rowKey = (organizationId: string, module: string) =>
    `${organizationId}:${module}`;

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.get(where.id) ?? null,
    },
    organizationUser: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organizationId?: string };
      }) =>
        memberships.find(
          (membership) =>
            membership.userId === where.userId &&
            membership.organizationId === where.organizationId,
        ) ?? null,
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === ORGANIZATION_ID
          ? { id: ORGANIZATION_ID, status: 'ACTIVE' }
          : null,
    },
    organizationModule: {
      findUnique: async ({
        where,
      }: {
        where: {
          organizationId_module: { organizationId: string; module: string };
        };
      }) => {
        const requested = where.organizationId_module;
        const row = rows.get(
          rowKey(requested.organizationId, requested.module),
        );
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: { where: { organizationId?: string } }) =>
        [...rows.values()]
          .filter((row) => row.organizationId === where.organizationId)
          .map((row) => ({ ...row })),
      upsert: async ({ where, create, update }: UpsertArgs) => {
        writes.upsert += 1;
        const requested = where.organizationId_module;
        const row: ModuleRow = {
          organizationId: requested.organizationId,
          module: requested.module,
          enabled: create?.enabled ?? update.enabled,
        };
        rows.set(rowKey(row.organizationId, row.module), row);
        return { ...row };
      },
    },
  };

  return { prisma, rows, writes };
}

interface InvalidFlagCase {
  label: string;
  payload: Record<string, unknown>;
}

const INVALID_FLAGS: InvalidFlagCase[] = [
  { label: 'the string "false"', payload: { enabled: 'false' } },
  { label: 'the string "true"', payload: { enabled: 'true' } },
  { label: 'zero', payload: { enabled: 0 } },
  { label: 'one', payload: { enabled: 1 } },
  { label: 'null', payload: { enabled: null } },
  { label: 'an object', payload: { enabled: { value: false } } },
  { label: 'an array', payload: { enabled: [] } },
  { label: 'a body without enabled', payload: {} },
];

describe('module flag boundary (production HTTP wiring)', () => {
  const jwt = new JwtService({ secret: SECRET });
  const signToken = (
    userId: string,
    role: string,
    organizationId: string | null,
  ) =>
    jwt.sign({
      sub: userId,
      email: `${userId}@fixture.test`,
      tokenVersion: 0,
      role,
      organizationId,
    });

  let app: INestApplication;
  let fixture: ReturnType<typeof createPrismaFixture>;
  let superToken: string;
  let adminToken: string;

  beforeAll(async () => {
    fixture = createPrismaFixture();
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminBusinessModulesController, BusinessModulesController],
      providers: [
        BusinessModulesService,
        JwtStrategy,
        OrganizationRequiredGuard,
        AdminOrganizationInterceptor,
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: SECRET }),
        },
        { provide: PrismaService, useValue: fixture.prisma },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    configureErrorHandling(app);
    await app.init();
    superToken = signToken('user-super', 'SUPER_ADMIN', null);
    adminToken = signToken('user-admin', 'ADMIN', ORGANIZATION_ID);
  });

  beforeEach(() => {
    fixture.rows.clear();
    fixture.writes.upsert = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  const patchModule = (token: string, payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

  const readCatalog = async (token: string = adminToken) => {
    const response = await request(app.getHttpServer())
      .get('/api/business-modules')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return response;
  };

  it.each(
    INVALID_FLAGS.flatMap((invalid) =>
      [true, false].map((initial) => ({ ...invalid, initial })),
    ),
  )(
    'rejects $label and leaves enabled=$initial unchanged',
    async ({ payload, initial }) => {
      const seeded = await patchModule(superToken, { enabled: initial });
      expect(seeded.status).toBe(200);

      const before = await readCatalog();
      expect(before.body).toEqual([{ ...VEHICLES, enabled: initial }]);
      const upsertsBefore = fixture.writes.upsert;

      const rejected = await patchModule(superToken, payload);
      const after = await readCatalog();

      expect(rejected.status).toBe(400);
      expect(rejected.body).toEqual({
        code: PUBLIC_ERROR_CODES.VALIDATION_ERROR,
        message: VALIDATION_MESSAGE,
        requestId: rejected.headers['x-request-id'],
      });
      expect(after.text).toBe(before.text);
      expect(fixture.writes.upsert).toBe(upsertsBefore);
    },
  );

  it.each([true, false])(
    'accepts a JSON boolean enabled=%s and the public read reports it',
    async (enabled) => {
      const response = await patchModule(superToken, { enabled });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ...VEHICLES, enabled });
      expect((await readCatalog()).body).toEqual([{ ...VEHICLES, enabled }]);
      expect(fixture.writes.upsert).toBe(1);
    },
  );

  it('keeps the SuperAdmin-only guard on the existing PATCH', async () => {
    const before = await readCatalog();

    const denied = await patchModule(adminToken, { enabled: false });

    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({
      code: PUBLIC_ERROR_CODES.FORBIDDEN,
      message: 'Access denied. Required roles: SUPER_ADMIN',
      requestId: denied.headers['x-request-id'],
    });
    expect((await readCatalog()).text).toBe(before.text);
    expect(fixture.writes.upsert).toBe(0);
  });
});
