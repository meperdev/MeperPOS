import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { OrgRole, Prisma, PrismaClient } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { resolveWritableSiteWithin } from './authorized-site';

const databaseUrl = process.env.T15_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)(
  'Transactional site authorization',
  () => {
    let prisma: PrismaClient;
    const prefix = `t15-${randomUUID()}`;
    const org = `${prefix}-org`;
    const otherOrg = `${prefix}-other-org`;
    const site = `${prefix}-site`;
    const unassignedSite = `${prefix}-unassigned`;
    const foreignSite = `${prefix}-foreign`;
    const person = `${prefix}-person`;
    const platform = `${prefix}-platform`;
    const actor: RequestUser = {
      userId: person,
      email: `${person}@example.test`,
      organizationId: org,
      role: OrgRole.CASHIER,
      tokenVersion: 0,
      isSuperAdmin: false,
    };
    const platformActor: RequestUser = {
      ...actor,
      userId: platform,
      email: `${platform}@example.test`,
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
    };
    const membershipKey = { organizationId: org, userId: person };
    const grant = { ...membershipKey, locationId: site };

    const inTransaction = <T>(
      work: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => prisma.$transaction(work, { timeout: 12000 });
    const resolve = (user = actor, id = site) =>
      inTransaction((tx) => resolveWritableSiteWithin(tx, user, id));

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_t15_[a-z0-9_]+$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T15 PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: databaseUrl });
      await prisma.organization.createMany({
        data: [org, otherOrg].map((id) => ({ id, name: id, slug: id })),
      });
      await prisma.location.createMany({
        data: [
          { id: site, organizationId: org, isDefault: true, name: 'Principal' },
          { id: unassignedSite, organizationId: org, name: 'Warehouse' },
          { id: foreignSite, organizationId: otherOrg, name: 'Other' },
        ],
      });
      await prisma.user.createMany({
        data: [person, platform].map((id) => ({
          id,
          name: id,
          email: `${id}@example.test`,
          password: 'not-a-login-credential',
          isSuperAdmin: id === platform,
        })),
      });
      await prisma.organizationUser.create({
        data: { ...membershipKey, role: OrgRole.CASHIER },
      });
      await prisma.membershipLocation.create({ data: grant });
    });

    afterAll(async () => {
      if (!prisma) return;
      try {
        await prisma.organization.deleteMany({
          where: { id: { in: [org, otherOrg] } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: [person, platform] } },
        });
      } finally {
        await prisma.$disconnect();
      }
    });

    it('honors the exact grant and never substitutes a default or another tenant', async () => {
      await expect(resolve()).resolves.toEqual({
        organizationId: org,
        locationId: site,
      });
      await expect(resolve(actor, '')).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });
      await expect(resolve(actor, unassignedSite)).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });
      await expect(resolve(actor, foreignSite)).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });
      await expect(
        resolve({ ...actor, organizationId: undefined }),
      ).rejects.toMatchObject({
        status: 403,
        message: 'Organization scope required',
      });
    });

    it('keeps admin access within the validated scope and refuses stale roles even with a grant', async () => {
      const admin = { ...actor, role: OrgRole.ADMIN };
      await expect(resolve(admin)).rejects.toMatchObject({
        status: 403,
        message: 'Location authorization changed',
      });
      await prisma.organizationUser.updateMany({
        where: membershipKey,
        data: { role: OrgRole.ADMIN },
      });
      try {
        await expect(resolve(admin, unassignedSite)).resolves.toEqual({
          organizationId: org,
          locationId: unassignedSite,
        });
        await expect(resolve(admin, foreignSite)).rejects.toMatchObject({
          status: 404,
          message: 'Location not found',
        });
        await expect(resolve()).rejects.toMatchObject({
          status: 403,
          message: 'Location authorization changed',
        });
      } finally {
        await prisma.organizationUser.updateMany({
          where: membershipKey,
          data: { role: OrgRole.CASHIER },
        });
      }
    });

    it('requires a live scoped platform identity and current token version', async () => {
      await expect(resolve(platformActor, unassignedSite)).resolves.toEqual({
        organizationId: org,
        locationId: unassignedSite,
      });
      await expect(resolve(platformActor, foreignSite)).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });
      await expect(
        resolve({ ...platformActor, tokenVersion: 1 }),
      ).rejects.toMatchObject({
        status: 403,
        message: 'Location authorization changed',
      });
      await prisma.user.update({
        where: { id: platform },
        data: { isSuperAdmin: false },
      });
      try {
        await expect(resolve(platformActor)).rejects.toMatchObject({
          status: 403,
          message: 'Location authorization changed',
        });
      } finally {
        await prisma.user.update({
          where: { id: platform },
          data: { isSuperAdmin: true },
        });
      }
    });

    it('rejects a teammate’s grant and an inactive account with its own grant', async () => {
      const rollback = new Error('Roll back authorization fixtures');
      await expect(
        inTransaction(async (tx) => {
          await tx.organizationUser.create({
            data: {
              organizationId: org,
              userId: platform,
              role: OrgRole.CASHIER,
            },
          });
          await tx.membershipLocation.deleteMany({ where: grant });
          await tx.membershipLocation.create({
            data: { ...grant, userId: platform },
          });
          await expect(
            resolveWritableSiteWithin(tx, actor, site),
          ).rejects.toMatchObject({
            status: 404,
            message: 'Location not found',
          });

          await tx.membershipLocation.create({ data: grant });
          await tx.user.update({
            where: { id: person },
            data: { active: false },
          });
          await expect(
            resolveWritableSiteWithin(tx, actor, site),
          ).rejects.toMatchObject({
            status: 403,
            message: 'Location authorization changed',
          });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });

    function deferred() {
      let release!: () => void;
      const wait = new Promise<void>((done) => {
        release = done;
      });
      return { wait, release };
    }

    async function pid(tx: Prisma.TransactionClient) {
      const [row] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      return row.pid;
    }

    async function expectBlocked(waiter: number, blocker: number) {
      const deadline = Date.now() + 4000;
      do {
        const [row] = await prisma.$queryRaw<{ blocked: boolean }[]>`
        SELECT ${blocker}::int = ANY(pg_blocking_pids(${waiter}::int)) AS blocked
      `;
        if (row.blocked) return;
        await delay(10);
      } while (Date.now() < deadline);
      throw new Error(
        'Expected the competing operation to wait on the exact transaction',
      );
    }

    it('holds the accepted grant until the surrounding transaction ends', async () => {
      const authorized = deferred();
      const finish = deferred();
      let authorizerPid = 0;
      let revokerPid = 0;
      const writer = inTransaction(async (tx) => {
        authorizerPid = await pid(tx);
        await resolveWritableSiteWithin(tx, actor, site);
        authorized.release();
        await finish.wait;
      });
      const revoking = deferred();
      const revoker = inTransaction(async (tx) => {
        await authorized.wait;
        revokerPid = await pid(tx);
        revoking.release();
        await tx.membershipLocation.deleteMany({ where: grant });
      });
      try {
        await Promise.race([revoking.wait, writer]);
        await expectBlocked(revokerPid, authorizerPid);
        finish.release();
        await Promise.all([writer, revoker]);
        await expect(resolve()).rejects.toMatchObject({
          status: 404,
          message: 'Location not found',
        });
      } finally {
        authorized.release();
        finish.release();
        await Promise.allSettled([writer, revoker]);
        await prisma.membershipLocation.createMany({
          data: grant,
          skipDuplicates: true,
        });
      }
    }, 16000);

    it('waits on an in-flight revocation and denies after it commits', async () => {
      const deleted = deferred();
      const finish = deferred();
      let authorizerPid = 0;
      let revokerPid = 0;
      const revoker = inTransaction(async (tx) => {
        revokerPid = await pid(tx);
        await tx.membershipLocation.deleteMany({ where: grant });
        deleted.release();
        await finish.wait;
      });
      const checking = deferred();
      const writer = inTransaction(async (tx) => {
        await deleted.wait;
        authorizerPid = await pid(tx);
        checking.release();
        return resolveWritableSiteWithin(tx, actor, site);
      });
      const verdict = expect(writer).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });
      try {
        await Promise.race([checking.wait, revoker]);
        await expectBlocked(authorizerPid, revokerPid);
        finish.release();
        await revoker;
        await verdict;
      } finally {
        deleted.release();
        finish.release();
        await Promise.allSettled([writer, revoker, verdict]);
        await prisma.membershipLocation.createMany({
          data: grant,
          skipDuplicates: true,
        });
      }
    }, 16000);

    it.each([
      Prisma.TransactionIsolationLevel.RepeatableRead,
      Prisma.TransactionIsolationLevel.Serializable,
    ])(
      'fails closed on a revoked grant in a prior %s snapshot',
      async (isolationLevel) => {
        try {
          await expect(
            prisma.$transaction(
              async (tx) => {
                // Establish a snapshot but do not take the resolver's row locks yet.
                expect(
                  await tx.membershipLocation.count({ where: grant }),
                ).toBe(1);
                await prisma.membershipLocation.deleteMany({ where: grant });
                return resolveWritableSiteWithin(tx, actor, site);
              },
              { isolationLevel },
            ),
          ).rejects.toMatchObject({ code: 'P2010', meta: { code: '40001' } });
        } finally {
          await prisma.membershipLocation.createMany({
            data: grant,
            skipDuplicates: true,
          });
        }
      },
    );
  },
);
