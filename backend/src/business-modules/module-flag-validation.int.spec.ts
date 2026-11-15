import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp, configureErrorHandling } from '../app-configuration';
import { PUBLIC_ERROR_CODES } from '../common/errors/public-error.model';

/**
 * Production-wired regression for the module flag boundary.
 *
 * main.ts applies `configureApp` + `configureErrorHandling`, and the latter
 * enables `enableImplicitConversion`. That option coerces a raw JSON value
 * such as the string "false" with `Boolean(value)` BEFORE class-validator
 * runs, so a SuperAdmin PATCH carrying a non-boolean flag used to answer 200
 * and store the opposite state. `UpdateModuleDto` restores the raw body value
 * locally so `@IsBoolean()` sees what the client actually sent.
 *
 * Every behavioral assertion goes through the public API: the rejected PATCH
 * response and the catalog read taken afterwards. Prisma only creates and
 * removes the synthetic fixtures.
 */
const VALIDATION_MESSAGE = 'enabled: enabled must be a boolean value';

interface InvalidFlagCase {
  label: string;
  payload: Record<string, unknown>;
}

const INVALID_FLAGS: InvalidFlagCase[] = [
  { label: 'the string "false"', payload: { enabled: 'false' } },
  { label: 'the string "true"', payload: { enabled: 'true' } },
  { label: 'a number', payload: { enabled: 1 } },
  { label: 'null', payload: { enabled: null } },
  { label: 'an object', payload: { enabled: {} } },
  { label: 'an array', payload: { enabled: [] } },
  { label: 'a body without the flag', payload: {} },
];

describe('module flag boundary (production HTTP wiring)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let organizationId: string;
  let adminUserId: string;
  let superUserId: string;
  let adminToken: string;
  let superToken: string;
  let route: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    configureErrorHandling(app);
    await app.init();

    prisma = new PrismaClient();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organization = await prisma.organization.create({
      data: { name: 'Flag boundary', slug: `flag-boundary-${suffix}` },
    });
    organizationId = organization.id;
    route = `/api/admin/organizations/${organizationId}/modules/vehicles`;

    const admin = await prisma.user.create({
      data: {
        name: 'Flag admin',
        email: `flag-admin-${suffix}@example.com`,
        password: 'not-a-password',
      },
    });
    const superUser = await prisma.user.create({
      data: {
        name: 'Flag super',
        email: `flag-super-${suffix}@example.com`,
        password: 'not-a-password',
        isSuperAdmin: true,
      },
    });
    adminUserId = admin.id;
    superUserId = superUser.id;
    await prisma.organizationUser.create({
      data: { organizationId, userId: adminUserId, role: 'ADMIN' },
    });

    const jwt = app.get(JwtService);
    adminToken = jwt.sign({
      sub: adminUserId,
      email: admin.email,
      organizationId,
      role: 'ADMIN',
      tokenVersion: 0,
    });
    superToken = jwt.sign({
      sub: superUserId,
      email: superUser.email,
      organizationId: null,
      role: 'SUPER_ADMIN',
      tokenVersion: 0,
    });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        if (organizationId) {
          await prisma.organization.deleteMany({
            where: { id: organizationId },
          });
        }
        const userIds = [adminUserId, superUserId].filter(Boolean);
        if (userIds.length > 0) {
          await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
      }
    } finally {
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  const authorization = (token: string) => `Bearer ${token}`;

  const readVehiclesFlag = async (): Promise<boolean> => {
    const catalog = await request(app.getHttpServer())
      .get('/api/business-modules')
      .set('Authorization', authorization(adminToken))
      .expect(200);
    const entries = catalog.body as Array<{ id: string; enabled: boolean }>;
    const vehicles = entries.find((entry) => entry.id === 'vehicles');
    if (!vehicles) throw new Error('vehicles missing from the module catalog');
    return vehicles.enabled;
  };

  const setFlag = (enabled: boolean) =>
    request(app.getHttpServer())
      .patch(route)
      .set('Authorization', authorization(superToken))
      .send({ enabled })
      .expect(200);

  it.each(INVALID_FLAGS)(
    'rejects $label with the canonical validation error and keeps the flag',
    async ({ payload }) => {
      // Known disabled baseline: any accidental write is visible in `after`.
      await setFlag(false);
      const before = await readVehiclesFlag();

      const rejected = await request(app.getHttpServer())
        .patch(route)
        .set('Authorization', authorization(superToken))
        .send(payload);
      const after = await readVehiclesFlag();
      const rejectedBody = rejected.body as {
        code?: string;
        message?: string;
      };

      expect({
        status: rejected.status,
        code: rejectedBody.code,
        message: rejectedBody.message,
        before,
        after,
      }).toEqual({
        status: 400,
        code: PUBLIC_ERROR_CODES.VALIDATION_ERROR,
        message: VALIDATION_MESSAGE,
        before: false,
        after: false,
      });
    },
  );

  it('accepts JSON booleans and applies each requested state', async () => {
    const disabled = await setFlag(false);
    expect(disabled.body).toEqual(
      expect.objectContaining({ id: 'vehicles', enabled: false }),
    );
    expect(await readVehiclesFlag()).toBe(false);

    const enabled = await setFlag(true);
    expect(enabled.body).toEqual(
      expect.objectContaining({ id: 'vehicles', enabled: true }),
    );
    expect(await readVehiclesFlag()).toBe(true);
  });
});
