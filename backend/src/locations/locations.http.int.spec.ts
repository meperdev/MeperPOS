import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { OrgRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { configureApp, configureErrorHandling } from '../app-configuration';
import { AppModule } from '../app.module';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { LocationsController } from './locations.controller';

describe('Location access (HTTP integration)', () => {
  let app: INestApplication<Server>;
  const prisma = new PrismaClient();
  const prefix = `site-access-${randomUUID()}`;
  const slugs = [`${prefix}-first`, `${prefix}-second`];
  const emails = [
    `${prefix}-ana@example.test`,
    `${prefix}-cashier@example.test`,
    `${prefix}-race@example.test`,
  ];
  const superAdminEmail = `${prefix}-superadmin@example.test`;
  const a = { id: randomUUID(), name: 'A', isDefault: true };
  const b = { id: randomUUID(), name: 'B', isDefault: false };
  const other = { id: randomUUID(), name: 'Other', isDefault: true };
  let admin: string;
  let adminAsCashier: string;
  let cashier: string;
  let cashierInOtherOrg: string;
  let superAdmin: string;
  let cashierId: string;
  let raceUserId: string;
  let adminId: string;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>({
      logger: false,
    });
    configureApp(app);
    configureErrorHandling(app);
    await app.init();

    const [first, second] = await Promise.all([
      prisma.organization.create({
        data: {
          name: 'Pilot business',
          slug: slugs[0],
          locations: { create: [a, b] },
        },
      }),
      prisma.organization.create({
        data: {
          name: 'Separate business',
          slug: slugs[1],
          locations: { create: other },
        },
      }),
    ]);
    orgId = first.id;
    otherOrgId = second.id;
    const [ana, employee, race] = await Promise.all(
      emails.map((email, index) =>
        prisma.user.create({
          data: {
            name: email,
            email,
            password: 'not-a-login-credential',
            organizationUsers: {
              create: [
                {
                  organizationId: first.id,
                  role: index === 0 ? OrgRole.ADMIN : OrgRole.CASHIER,
                },
                { organizationId: second.id, role: OrgRole.CASHIER },
              ],
            },
          },
        }),
      ),
    );
    const superAdminUser = await prisma.user.create({
      data: {
        name: 'Platform admin',
        email: superAdminEmail,
        password: 'not-a-login-credential',
        isSuperAdmin: true,
      },
    });
    const jwt = app.get(JwtService);
    const sign = (
      user: { id: string; email: string; tokenVersion: number },
      organizationId: string | null,
      role: OrgRole | 'SUPER_ADMIN',
    ) =>
      `Bearer ${jwt.sign({
        sub: user.id,
        email: user.email,
        tokenVersion: user.tokenVersion,
        organizationId,
        role,
      })}`;
    admin = sign(ana, first.id, OrgRole.ADMIN);
    adminId = ana.id;
    adminAsCashier = sign(ana, second.id, OrgRole.CASHIER);
    cashier = sign(employee, first.id, OrgRole.CASHIER);
    cashierInOtherOrg = sign(employee, second.id, OrgRole.CASHIER);
    cashierId = employee.id;
    raceUserId = race.id;
    superAdmin = sign(superAdminUser, null, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: { in: slugs } } });
    await prisma.user.deleteMany({
      where: { email: { in: [...emails, superAdminEmail] } },
    });
    await prisma.$disconnect();
    await app?.close();
  });

  it('declares the matrix read roles and preserves the assignment role override', () => {
    const controller = LocationsController;
    const readRoles = [
      OrgRole.OWNER,
      OrgRole.ADMIN,
      OrgRole.MEMBER,
      OrgRole.CASHIER,
      OrgRole.INVENTORY_USER,
    ];
    for (const handler of [
      controller.prototype.list,
      controller.prototype.posContext,
      controller.prototype.find,
    ]) {
      const roles =
        Reflect.getMetadata(ROLES_KEY, handler) ??
        Reflect.getMetadata(ROLES_KEY, controller);
      expect(roles).toHaveLength(readRoles.length);
      expect(roles).toEqual(expect.arrayContaining(readRoles));
    }
    expect(Reflect.getMetadata(ROLES_KEY, controller.prototype.replace)).toEqual([
      OrgRole.ADMIN,
    ]);
  });

  const get = (auth: string, id?: string) =>
    request(app.getHttpServer())
      .get(id ? `/api/locations/${id}` : '/api/locations')
      .set('Authorization', auth);
  const assign = (auth: string, id: string, locationIds: string[]) =>
    request(app.getHttpServer())
      .put(`/api/users/${id}/locations`)
      .set('Authorization', auth)
      .send({ locationIds });

  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };

  /**
   * Waits until the replacement's DELETE is really blocked on the lock the test
   * holds, so the competing promotion is attempted while the service is between
   * its target read and its grant write.
   */
  const waitForGrantDeleteWait = async (blockerPid: number, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [waiting] = await prisma.$queryRaw<{ pid: number }[]>`
        SELECT pid
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE 'DELETE FROM%'
          AND query LIKE '%MembershipLocation%'
          AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))
        LIMIT 1`;
      if (waiting) return;
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error('The replacement never waited on its grant DELETE');
  };

  /** Waits until the replacement is blocked on the locked target read. */
  const waitForLockedTargetRead = async (blockerPid: number, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [waiting] = await prisma.$queryRaw<{ pid: number }[]>`
        SELECT pid
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE '%membership."role"%'
          AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))
        LIMIT 1`;
      if (waiting) return;
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error('The replacement never waited on the locked target read');
  };

  const errorEvidence = (error: unknown) => {
    if (!(error instanceof Error)) return String(error);
    const meta = (error as { meta?: unknown }).meta;
    return `${error.message} ${JSON.stringify(meta ?? '')}`;
  };

  it('scopes the cashier to explicit assignments in the selected membership, even with the same token', async () => {
    await get(cashier).expect(200, []);
    await assign(admin, cashierId, [a.id]).expect(200, { locationIds: [a.id] });
    await get(cashier).expect(200, [a]);
    await get(cashier, a.id).expect(200, a);
    const denied = await get(cashier, b.id).expect(404);
    expect(denied.body).toMatchObject({ message: 'Location not found' });
    await get(cashierInOtherOrg).expect(200, []);

    await assign(admin, cashierId, [a.id, b.id]).expect(200, {
      locationIds: [a.id, b.id],
    });
    await get(cashier).expect(200, [a, b]);
    await get(cashier, b.id).expect(200, b);
    await get(cashier, other.id).expect(404);
    await assign(admin, cashierId, [b.id]).expect(200, { locationIds: [b.id] });
    await get(cashier).expect(200, [b]);
    await get(cashier, a.id).expect(404);
    await assign(admin, cashierId, []).expect(200, { locationIds: [] });
    await get(cashier).expect(200, []);
    await get(cashier, b.id).expect(404);
  });

  it('allows Ana both sites as admin, without carrying the role or scope into another organization', async () => {
    await get(admin).set('x-organization-id', otherOrgId).expect(200, [a, b]);
    await get(admin, a.id).expect(200, a);
    await get(admin, b.id).expect(200, b);
    await get(admin, other.id).expect(404);
    await get(adminAsCashier).expect(200, []);
    await assign(admin, adminId, [a.id]).expect(409);
  });

  it('rejects changes from cashiers or using a foreign location without altering the existing scope', async () => {
    await assign(admin, cashierId, [a.id]).expect(200, { locationIds: [a.id] });
    await assign(cashier, cashierId, [b.id]).expect(403);
    const foreign = await assign(admin, cashierId, [a.id, other.id]).expect(
      404,
    );
    expect(foreign.body).toMatchObject({ message: 'Location not found' });
    await assign(admin, cashierId, [a.id, a.id]).expect(400);
    await get(cashier).expect(200, [a]);
    await get(cashierInOtherOrg).expect(200, []);
  });

  it('lists permitted POS sites without granting global checkout in a multi-site organization', async () => {
    await assign(admin, cashierId, [a.id]).expect(200, { locationIds: [a.id] });
    await get(cashier, 'pos-context').expect(200, {
      locations: [a],
      checkoutLocationId: null,
    });
    await get(cashierInOtherOrg, 'pos-context').expect(200, {
      locations: [],
      checkoutLocationId: null,
    });
  });

  it('recomputes checkout in the session organization after site and grant changes', async () => {
    const addedId = randomUUID();
    const grant = (ids: string[]) =>
      assign(superAdmin, cashierId, ids).set('x-organization-id', otherOrgId);
    const context = () =>
      get(cashierInOtherOrg, 'pos-context')
        .set('x-organization-id', orgId)
        .query({ organizationId: orgId });

    try {
      await grant([other.id]).expect(200, { locationIds: [other.id] });
      await context().expect(200, {
        locations: [other],
        checkoutLocationId: other.id,
      });

      await prisma.location.create({
        data: { id: addedId, organizationId: otherOrgId, name: 'New site' },
      });
      await context().expect(200, {
        locations: [other],
        checkoutLocationId: null,
      });

      await prisma.location.delete({ where: { id: addedId } });
      await context().expect(200, {
        locations: [other],
        checkoutLocationId: other.id,
      });

      await grant([]).expect(200, { locationIds: [] });
      await context().expect(200, { locations: [], checkoutLocationId: null });
    } finally {
      await prisma.location.deleteMany({ where: { id: addedId } });
      await grant([]).expect(200, { locationIds: [] });
    }
  });

  it('requires a selected organization for a SUPER_ADMIN POS context', async () => {
    const missing = await get(superAdmin, 'pos-context').expect(403);
    expect(missing.body).toMatchObject({
      message: expect.stringContaining('Organization scope required'),
    });
    await get(superAdmin, 'pos-context')
      .set('x-organization-id', orgId)
      .expect(200, { locations: [a, b], checkoutLocationId: null });
  });

  it(
    'serializes a role promotion behind the assignment replacement it overlaps',
    async () => {
      await assign(admin, cashierId, [a.id]).expect(200, {
        locationIds: [a.id],
      });

      const locker = new PrismaClient();
      const promoter = new PrismaClient();
      const lockerReady = deferred();
      const releaseLocker = deferred();
      let lockerPid = 0;
      let replacementSettled: Promise<void> | null = null;
      let replacementError: unknown = null;
      let promotion: { blocked: boolean; error?: unknown } | null = null;

      const lockerTransaction = locker.$transaction(
        async (tx) => {
          // Hold the target's current grant so the replacement's DELETE waits
          // after it has read the target membership.
          await tx.$queryRaw`
            SELECT 1
            FROM "MembershipLocation"
            WHERE "userId" = ${cashierId}
              AND "organizationId" = ${orgId}
            FOR UPDATE`;
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
            SELECT pg_backend_pid() AS pid`;
          lockerPid = pid;
          lockerReady.resolve();
          await releaseLocker.promise;
        },
        { timeout: 20000 },
      );

      try {
        try {
          await lockerReady.promise;
          const replacement = assign(admin, cashierId, [b.id]).expect(200, {
            locationIds: [b.id],
          });
          replacementSettled = Promise.resolve(replacement).then(
            () => undefined,
            (error: unknown) => {
              replacementError = error;
            },
          );
          await waitForGrantDeleteWait(lockerPid);

          // The promotion is another READ COMMITTED writer. Its bounded lock
          // timeout proves whether the target row was protected before the
          // grant delete, instead of relying on commit order inspection.
          promotion = await promoter
            .$transaction(async (tx) => {
              await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '500ms'`);
              await tx.$executeRaw`
                UPDATE "OrganizationUser"
                SET "role" = 'ADMIN'
                WHERE "userId" = ${cashierId}
                  AND "organizationId" = ${orgId}`;
            })
            .then(
              () => ({ blocked: false }),
              (error: unknown) => ({ blocked: true, error }),
            );
        } finally {
          releaseLocker.resolve();
          await lockerTransaction;
          if (replacementSettled) await replacementSettled;
        }

        expect(replacementError).toBeNull();
        expect(promotion).not.toBeNull();
        expect(promotion?.blocked).toBe(true);
        expect(errorEvidence(promotion?.error)).toMatch(/55P03|lock timeout/i);

        // Once the replacement commits, the same promotion succeeds normally;
        // the service never retried its grant write.
        await promoter.organizationUser.update({
          where: {
            userId_organizationId: { userId: cashierId, organizationId: orgId },
          },
          data: { role: OrgRole.ADMIN },
        });
        const promoted = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: { userId: cashierId, organizationId: orgId },
          },
          select: { role: true },
        });
        expect(promoted?.role).toBe(OrgRole.ADMIN);
      } finally {
        await locker.$disconnect();
        await promoter.$disconnect();
      }
    },
    15000,
  );

  it(
    'fails the assignment when a promotion commits under its locked target read',
    async () => {
      await assign(admin, raceUserId, [a.id]).expect(200, {
        locationIds: [a.id],
      });

      const promoter = new PrismaClient();
      const promotionHeld = deferred();
      const releasePromotion = deferred();
      let promoterPid = 0;
      const promotion = promoter.$transaction(
        async (tx) => {
          await tx.$executeRaw`
            UPDATE "OrganizationUser"
            SET "role" = 'ADMIN'
            WHERE "userId" = ${raceUserId}
              AND "organizationId" = ${orgId}`;
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
            SELECT pg_backend_pid() AS pid`;
          promoterPid = pid;
          promotionHeld.resolve();
          await releasePromotion.promise;
        },
        { timeout: 20000 },
      );

      let replacementError: unknown = null;
      let replacementMessage: unknown = null;
      try {
        // The promotion holds an uncommitted row update when the replacement
        // starts, so the replacement's FOR SHARE waits behind it.
        await promotionHeld.promise;
        const replacement = assign(admin, raceUserId, [b.id]).expect(409);
        const replacementSettled = Promise.resolve(replacement).then(
          (response) => {
            replacementMessage = (response.body as { message?: unknown })
              .message;
          },
          (error: unknown) => {
            replacementError = error;
          },
        );
        await waitForLockedTargetRead(promoterPid);
        releasePromotion.resolve();
        await promotion;
        await replacementSettled;
      } finally {
        releasePromotion.resolve();
        await promotion.catch(() => undefined);
        await promoter.$disconnect();
      }

      expect(replacementError).toBeNull();
      expect(replacementMessage).toBe(
        'Location assignments changed concurrently',
      );
      const grant = await prisma.membershipLocation.findMany({
        where: { userId: raceUserId, organizationId: orgId },
        select: { locationId: true },
      });
      expect(grant.map((row) => row.locationId)).toEqual([a.id]);
    },
    15000,
  );
});
