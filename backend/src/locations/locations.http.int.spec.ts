import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { OrgRole, PrismaClient } from '@prisma/client';
import request, { type Response } from 'supertest';
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
  const memberEmail = `${prefix}-member@example.test`;
  const inventoryEmail = `${prefix}-inventory@example.test`;
  const foreignEmail = `${prefix}-foreign@example.test`;
  // Every site response carries the optional contact fields, null until a
  // fixture or the API sets them.
  const a = {
    id: randomUUID(),
    name: 'A',
    type: 'STORE',
    isDefault: true,
    address: null,
    phone: null,
  };
  const b = {
    id: randomUUID(),
    name: 'B',
    type: 'STORE',
    isDefault: false,
    address: null,
    phone: null,
  };
  const other = {
    id: randomUUID(),
    name: 'Other',
    type: 'STORE',
    isDefault: true,
    address: null,
    phone: null,
  };
  /**
   * Inserts a fixture site. The `type` column arrives with this feature, so the
   * creation payload is written out instead of spreading a response shape that
   * a stale generated client would reject.
   */
  const seeded = (site: { id: string; name: string; isDefault: boolean }) => ({
    id: site.id,
    name: site.name,
    isDefault: site.isDefault,
  });
  /** Sites this suite creates through the API, removed again in `afterAll`. */
  const createdLocationIds: string[] = [];
  let admin: string;
  let adminAsCashier: string;
  let cashier: string;
  let cashierInOtherOrg: string;
  let member: string;
  let inventoryUser: string;
  let superAdmin: string;
  let cashierId: string;
  let raceUserId: string;
  let adminId: string;
  let foreignUserId: string;
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
          locations: { create: [seeded(a), seeded(b)] },
        },
      }),
      prisma.organization.create({
        data: {
          name: 'Separate business',
          slug: slugs[1],
          locations: { create: [seeded(other)] },
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
    const [memberAccount, inventoryAccount, foreignAccount] = await Promise.all(
      [
        prisma.user.create({
          data: {
            name: 'Member',
            email: memberEmail,
            password: 'not-a-login-credential',
            organizationUsers: {
              create: [{ organizationId: first.id, role: OrgRole.MEMBER }],
            },
          },
        }),
        prisma.user.create({
          data: {
            name: 'Inventory',
            email: inventoryEmail,
            password: 'not-a-login-credential',
            organizationUsers: {
              create: [
                { organizationId: first.id, role: OrgRole.INVENTORY_USER },
              ],
            },
          },
        }),
        prisma.user.create({
          data: {
            name: 'Foreign',
            email: foreignEmail,
            password: 'not-a-login-credential',
            organizationUsers: {
              create: [{ organizationId: second.id, role: OrgRole.CASHIER }],
            },
          },
        }),
      ],
    );
    member = sign(memberAccount, first.id, OrgRole.MEMBER);
    inventoryUser = sign(inventoryAccount, first.id, OrgRole.INVENTORY_USER);
    foreignUserId = foreignAccount.id;
    superAdmin = sign(superAdminUser, null, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    await prisma.location.deleteMany({
      where: { id: { in: createdLocationIds } },
    });
    await prisma.organization.deleteMany({ where: { slug: { in: slugs } } });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            memberEmail,
            inventoryEmail,
            foreignEmail,
            ...emails,
            superAdminEmail,
          ],
        },
      },
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
    for (const handler of [
      controller.prototype.create,
      controller.prototype.update,
      controller.prototype.assignments,
      controller.prototype.replace,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([OrgRole.ADMIN]);
    }
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
  const createSite = (
    auth: string,
    body: {
      name: string;
      type: string;
      address?: string;
      phone?: string;
    },
  ) =>
    request(app.getHttpServer())
      .post('/api/locations')
      .set('Authorization', auth)
      .send(body);
  const patchSite = (
    auth: string,
    id: string,
    body: {
      name?: string;
      type?: string;
      address?: string;
      phone?: string;
    },
  ) =>
    request(app.getHttpServer())
      .patch(`/api/locations/${id}`)
      .set('Authorization', auth)
      .send(body);
  const assignmentsOf = (auth: string, id: string) =>
    request(app.getHttpServer())
      .get(`/api/users/${id}/locations`)
      .set('Authorization', auth);

  type SiteBody = {
    id: string;
    name: string;
    type: string;
    isDefault: boolean;
    address: string | null;
    phone: string | null;
  };
  const siteBody = (response: Response) => response.body as SiteBody;
  const assignmentsBody = (response: Response) =>
    response.body as { locationIds: string[]; orgWideAccess: boolean };

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
  const waitForGrantDeleteWait = async (
    blockerPid: number,
    timeoutMs = 5000,
  ) => {
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
  const waitForLockedTargetRead = async (
    blockerPid: number,
    timeoutMs = 5000,
  ) => {
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
    // T3h: a new operational membership starts with its own organization's
    // principal site — and with nothing else.
    await get(cashier).expect(200, [a]);
    await assign(admin, cashierId, [a.id]).expect(200, { locationIds: [a.id] });
    await get(cashier).expect(200, [a]);
    await get(cashier, a.id).expect(200, a);
    const denied = await get(cashier, b.id).expect(404);
    expect(denied.body).toMatchObject({ message: 'Location not found' });
    await get(cashierInOtherOrg).expect(200, [other]);

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
    // Ana's cashier membership in the other organization holds that tenant's
    // principal site, never the sites of the organization she administers.
    await get(adminAsCashier).expect(200, [other]);
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
    await get(cashierInOtherOrg).expect(200, [other]);
  });

  it('nominates the reachable principal store and lists stores only', async () => {
    await assign(admin, cashierId, [a.id]).expect(200, { locationIds: [a.id] });
    await get(cashier, 'pos-context').expect(200, {
      locations: [a],
      checkoutLocationId: a.id,
    });
    // A warehouse is never offered to the till, even when it is assigned.
    const bodegaId = randomUUID();
    createdLocationIds.push(bodegaId);
    await prisma.location.create({
      data: {
        id: bodegaId,
        organizationId: orgId,
        name: `${prefix}-bodega`,
        type: 'WAREHOUSE',
      },
    });
    await assign(admin, cashierId, [a.id, bodegaId]).expect(200, {
      locationIds: [a.id, bodegaId],
    });
    await get(cashier, 'pos-context').expect(200, {
      locations: [a],
      checkoutLocationId: a.id,
    });
    await get(cashierInOtherOrg, 'pos-context').expect(200, {
      locations: [other],
      checkoutLocationId: other.id,
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
      // T3g: the principal store stays nominated while the caller reaches it;
      // adding a site no longer takes checkout away from it.
      await context().expect(200, {
        locations: [other],
        checkoutLocationId: other.id,
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
      .expect(200, { locations: [a, b], checkoutLocationId: a.id });
  });

  it('serializes a role promotion behind the assignment replacement it overlaps', async () => {
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
  }, 15000);

  it('fails the assignment when a promotion commits under its locked target read', async () => {
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
          replacementMessage = (response.body as { message?: unknown }).message;
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
  }, 15000);

  it('creates named sites for administrators without granting access to them', async () => {
    // The concurrent-promotion cases above leave this membership promoted; the
    // directory cases below need it restricted to explicit assignments again.
    await prisma.organizationUser.update({
      where: {
        userId_organizationId: { userId: cashierId, organizationId: orgId },
      },
      data: { role: OrgRole.CASHIER },
    });
    await assign(admin, cashierId, [a.id]).expect(200, { locationIds: [a.id] });

    const warehouse = siteBody(
      await createSite(admin, {
        name: 'Bodega norte',
        type: 'WAREHOUSE',
      }).expect(201),
    );
    const store = siteBody(
      await createSite(admin, {
        name: 'Sucursal centro',
        type: 'STORE',
      }).expect(201),
    );
    createdLocationIds.push(warehouse.id, store.id);

    expect(warehouse).toMatchObject({
      name: 'Bodega norte',
      type: 'WAREHOUSE',
      isDefault: false,
    });
    expect(store).toMatchObject({
      name: 'Sucursal centro',
      type: 'STORE',
      isDefault: false,
    });

    const listed = (await get(admin).expect(200)).body as SiteBody[];
    expect(listed.map(({ id }) => id)).toEqual(
      expect.arrayContaining([warehouse.id, store.id]),
    );
    expect(listed.filter(({ id }) => id === warehouse.id)[0]).toEqual(
      warehouse,
    );

    // S3: creating a site must not hand anybody access to it.
    await expect(
      prisma.membershipLocation.count({
        where: { locationId: { in: [warehouse.id, store.id] } },
      }),
    ).resolves.toBe(0);
    await get(cashier).expect(200, [a]);
    await get(cashier, warehouse.id).expect(404);

    const renamed = siteBody(
      await patchSite(admin, warehouse.id, {
        name: 'Bodega sur',
        type: 'STORE',
      }).expect(200),
    );
    expect(renamed).toEqual({
      ...warehouse,
      name: 'Bodega sur',
      type: 'STORE',
    });
    await get(cashier, warehouse.id).expect(404);
  });

  it('stores, trims and clears the contact details of a site', async () => {
    const created = siteBody(
      await createSite(admin, {
        name: 'Sucursal con contacto',
        type: 'STORE',
        address: '  Calle 10 # 5-20  ',
        phone: '  +57 604 444 5566  ',
      }).expect(201),
    );
    createdLocationIds.push(created.id);
    expect(created).toMatchObject({
      name: 'Sucursal con contacto',
      address: 'Calle 10 # 5-20',
      phone: '+57 604 444 5566',
    });
    await get(admin, created.id).expect(200, created);
    expect((await get(admin).expect(200)).body).toEqual(
      expect.arrayContaining([created]),
    );

    const patched = siteBody(
      await patchSite(admin, created.id, {
        address: 'Carrera 43 # 1-50',
      }).expect(200),
    );
    expect(patched).toMatchObject({
      address: 'Carrera 43 # 1-50',
      phone: '+57 604 444 5566',
    });

    // A blank value clears the field; the rest of the site stays untouched.
    const cleared = siteBody(
      await patchSite(admin, created.id, {
        address: '   ',
        phone: '',
      }).expect(200),
    );
    expect(cleared).toMatchObject({
      name: 'Sucursal con contacto',
      type: 'STORE',
      address: null,
      phone: null,
    });

    // A site created without contact details answers null, not an empty string.
    const plain = siteBody(
      await createSite(admin, {
        name: 'Sucursal sin contacto',
        type: 'STORE',
      }).expect(201),
    );
    createdLocationIds.push(plain.id);
    expect(plain).toMatchObject({ address: null, phone: null });

    // The bounds follow the columns: 200 characters for the address, 40 for
    // the phone.
    await createSite(admin, {
      name: 'Sucursal larga',
      type: 'STORE',
      address: 'x'.repeat(201),
    }).expect(400);
    await createSite(admin, {
      name: 'Sucursal larga',
      type: 'STORE',
      phone: '1'.repeat(41),
    }).expect(400);
    await patchSite(admin, created.id, {
      address: 'x'.repeat(201),
    }).expect(400);
    await patchSite(admin, created.id, {
      phone: '1'.repeat(41),
    }).expect(400);

    // Rejected writes leave the stored site exactly as it was.
    await get(admin, created.id).expect(200, cleared);
    await expect(
      prisma.location.count({
        where: { name: 'Sucursal larga', organizationId: orgId },
      }),
    ).resolves.toBe(0);
  });

  it('refuses a duplicate site name in the same organization, ignoring case and spacing', async () => {
    const created = siteBody(
      await createSite(admin, {
        name: '  Bodega réplica  ',
        type: 'WAREHOUSE',
      }).expect(201),
    );
    createdLocationIds.push(created.id);
    expect(created.name).toBe('Bodega réplica');

    const before = await prisma.location.count({
      where: { organizationId: orgId },
    });
    const duplicate = await createSite(admin, {
      name: 'BODEGA RÉPLICA',
      type: 'STORE',
    }).expect(409);
    expect(duplicate.body).toMatchObject({
      message: 'A location with this name already exists',
    });
    const renameCollision = await patchSite(admin, b.id, {
      name: 'bodega réplica',
    }).expect(409);
    expect(renameCollision.body).toMatchObject({
      message: 'A location with this name already exists',
    });
    await expect(
      prisma.location.count({ where: { organizationId: orgId } }),
    ).resolves.toBe(before);

    // The unique name is per organization, not global.
    const elsewhere = siteBody(
      await createSite(superAdmin, {
        name: 'bodega réplica',
        type: 'WAREHOUSE',
      })
        .set('x-organization-id', otherOrgId)
        .expect(201),
    );
    createdLocationIds.push(elsewhere.id);
  });

  it('rejects a blank, oversized or unknown site definition', async () => {
    const before = await prisma.location.count({
      where: { organizationId: orgId },
    });
    await createSite(admin, { name: '   ', type: 'STORE' }).expect(400);
    await createSite(admin, { name: 'x'.repeat(81), type: 'STORE' }).expect(
      400,
    );
    await createSite(admin, { name: 'Sede válida', type: 'BAKERY' }).expect(
      400,
    );
    await patchSite(admin, b.id, { name: '' }).expect(400);
    await patchSite(admin, b.id, { type: 'BAKERY' }).expect(400);

    await expect(
      prisma.location.count({ where: { organizationId: orgId } }),
    ).resolves.toBe(before);
    await get(admin, b.id).expect(200, b);
  });

  it('rejects site management from members, cashiers and inventory users', async () => {
    for (const auth of [member, cashier, inventoryUser]) {
      await createSite(auth, {
        name: 'Bodega prohibida',
        type: 'WAREHOUSE',
      }).expect(403);
      await patchSite(auth, a.id, { name: 'Renombrada' }).expect(403);
      await assignmentsOf(auth, cashierId).expect(403);
    }
    await expect(
      prisma.location.count({
        where: { organizationId: orgId, name: 'Bodega prohibida' },
      }),
    ).resolves.toBe(0);
    await get(admin, a.id).expect(200, a);
  });

  it('keeps another tenant’s sites and assignments out of reach', async () => {
    const foreign = await patchSite(admin, other.id, {
      type: 'WAREHOUSE',
    }).expect(404);
    expect(foreign.body).toMatchObject({ message: 'Location not found' });
    await patchSite(adminAsCashier, a.id, { name: 'Intrusa' }).expect(403);
    await assignmentsOf(admin, foreignUserId).expect(404);
    await assignmentsOf(adminAsCashier, foreignUserId).expect(403);

    await expect(
      prisma.location.findUnique({
        where: { id: other.id },
        select: { name: true, type: true },
      }),
    ).resolves.toEqual({ name: 'Other', type: 'STORE' });
  });

  it('keeps the principal site a store while other sites may change type', async () => {
    const refused = await patchSite(admin, a.id, {
      type: 'WAREHOUSE',
    }).expect(400);
    expect(refused.body).toMatchObject({
      message: 'The principal site cannot become a warehouse',
    });
    await get(admin, a.id).expect(200, a);

    const warehouse = siteBody(
      await patchSite(admin, b.id, { type: 'WAREHOUSE' }).expect(200),
    );
    expect(warehouse).toEqual({ ...b, type: 'WAREHOUSE' });
    await get(admin, b.id).expect(200, { ...b, type: 'WAREHOUSE' });
    await patchSite(admin, b.id, { type: 'STORE' }).expect(200);

    const renamed = siteBody(
      await patchSite(admin, a.id, { name: 'Principal' }).expect(200),
    );
    expect(renamed).toEqual({ ...a, name: 'Principal' });
    await patchSite(admin, a.id, { name: a.name }).expect(200);

    const restored = siteBody(await get(admin, a.id).expect(200));
    expect(restored).toEqual(a);
  });

  it('reads the explicit assignments of a restricted membership', async () => {
    await assign(admin, cashierId, [b.id, a.id]).expect(200, {
      locationIds: [b.id, a.id],
    });
    const listed = assignmentsBody(
      await assignmentsOf(admin, cashierId).expect(200),
    );
    expect([...listed.locationIds].sort()).toEqual([a.id, b.id].sort());
    expect(listed.orgWideAccess).toBe(false);

    // Organization-wide roles hold no explicit assignment rows: the role is
    // their access, so the read says so instead of returning an empty set.
    await assignmentsOf(admin, adminId).expect(200, {
      locationIds: [],
      orgWideAccess: true,
    });

    await assign(admin, cashierId, []).expect(200, { locationIds: [] });
    await assignmentsOf(admin, cashierId).expect(200, {
      locationIds: [],
      orgWideAccess: false,
    });
  });
});
