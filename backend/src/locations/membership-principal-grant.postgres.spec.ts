import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { OrgRole, Prisma, PrismaClient } from '@prisma/client';

/**
 * T3h — a new operational membership starts at the organization's principal
 * site (S3), and adding a site never widens anybody's access.
 *
 * `20261125160000_membership_principal_grant` installs two things:
 *
 *   * an AFTER INSERT OR UPDATE OF "role" trigger on `OrganizationUser` that
 *     grants the organization's principal site to a new CASHIER, MEMBER or
 *     INVENTORY_USER membership, and to a membership demoted from OWNER/ADMIN
 *     to one of those roles while it still holds no grant at all;
 *   * a one-shot backfill that gives the principal site to the operational
 *     memberships that already existed with zero grants.
 *
 * Two suites, each bound to its own explicitly provided disposable database:
 *
 *   * `T3H_TEST_DATABASE_URL` — a migrated database where the suite creates its
 *     own uniquely named tenants and may write freely. This is where the
 *     trigger, the site-creation rule, the cross-tenant constraint and the
 *     deletion/lock behaviour are proved.
 *   * `T3H_BACKFILL_DATABASE_URL` — a database whose fixture rows were created
 *     BEFORE this migration was applied, so the backfill can be observed. The
 *     suite only reads those fixed rows:
 *     organization `t3h-backfill-org` with default site
 *     `t3h-backfill-principal` and second site `t3h-backfill-secondary`;
 *     operational memberships `t3h-backfill-cashier`, `t3h-backfill-member`
 *     and `t3h-backfill-inventory` with zero grants; administrator membership
 *     `t3h-backfill-admin` with zero grants; `t3h-backfill-assigned` (CASHIER)
 *     holding only `t3h-backfill-secondary`; organization
 *     `t3h-backfill-nosite-org` with no site and CASHIER membership
 *     `t3h-backfill-nosite-user`; organization `t3h-backfill-other-org` with
 *     default site `t3h-backfill-other-principal` and CASHIER membership
 *     `t3h-backfill-elsewhere`.
 *
 * Both suites are skipped unless their variable is set. Against a database
 * without the migration the trigger cases and the backfill cases simply see the
 * old rules, so they fail: that is the intended RED.
 *
 *   T3H_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_t3h?schema=public \
 *   T3H_BACKFILL_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_t3h_backfill?schema=public \
 *     npx jest --runInBand src/locations/membership-principal-grant.postgres.spec.ts
 */

const TRIGGER_DATABASE_URL = process.env.T3H_TEST_DATABASE_URL;
const BACKFILL_DATABASE_URL = process.env.T3H_BACKFILL_DATABASE_URL;

/** Accepts only the disposable T3h clones, never a shared or running database. */
function disposableDatabase(variable: string, value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.port === '5432' ||
    url.search !== '?schema=public' ||
    !/^\/meperpos_stock_rehearsal_t3h[a-z0-9_]*$/.test(url.pathname)
  ) {
    throw new Error(
      `Expected an explicit disposable T3h database in ${variable}`,
    );
  }
  return url.href;
}

function deferred() {
  let release!: () => void;
  const wait = new Promise<void>((done) => {
    release = done;
  });
  return { wait, release };
}

async function backendPid(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`
    SELECT pg_backend_pid() AS pid`;
  return row.pid;
}

/** Waits until `waiter` is really blocked by the exact transaction `blocker`. */
async function expectBlocked(
  prisma: PrismaClient,
  waiter: number,
  blocker: number,
) {
  const deadline = Date.now() + 5000;
  do {
    const [row] = await prisma.$queryRaw<{ blocked: boolean }[]>`
      SELECT ${blocker}::int = ANY(pg_blocking_pids(${waiter}::int)) AS blocked`;
    if (row.blocked) return;
    await delay(10);
  } while (Date.now() < deadline);
  throw new Error(
    'Expected the competing operation to wait on the exact transaction',
  );
}

const sorted = (ids: string[]) => [...ids].sort();

(TRIGGER_DATABASE_URL ? describe : describe.skip)(
  'Principal site for new operational memberships (real PostgreSQL)',
  () => {
    let prisma: PrismaClient;
    const label = `t3h-${randomUUID()}`;
    const organizations: string[] = [];
    const people: string[] = [];

    beforeAll(() => {
      prisma = new PrismaClient({
        datasourceUrl: disposableDatabase(
          'T3H_TEST_DATABASE_URL',
          TRIGGER_DATABASE_URL!,
        ),
      });
    });

    afterAll(async () => {
      if (!prisma) return;
      try {
        if (people.length > 0) {
          await prisma.user.deleteMany({ where: { id: { in: people } } });
        }
        if (organizations.length > 0) {
          await prisma.organization.deleteMany({
            where: { id: { in: organizations } },
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    });

    async function organization(tag: string): Promise<string> {
      const unique = `${label}-${tag}`;
      const created = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      organizations.push(created.id);
      return created.id;
    }

    async function site(
      organizationId: string,
      name: string,
      isDefault = false,
    ): Promise<string> {
      const created = await prisma.location.create({
        data: { organizationId, name: `${label}-${name}`, isDefault },
      });
      return created.id;
    }

    async function person(tag: string): Promise<string> {
      const email = `${label}-${tag}-${randomUUID()}@example.test`;
      const created = await prisma.user.create({
        data: { email, name: email, password: 'not-a-login-credential' },
      });
      people.push(created.id);
      return created.id;
    }

    function membership(organizationId: string, userId: string, role: OrgRole) {
      return prisma.organizationUser.create({
        data: { organizationId, userId, role },
      });
    }

    async function grantedIds(organizationId: string, userId: string) {
      const grants = await prisma.membershipLocation.findMany({
        where: { organizationId, userId },
        select: { locationId: true },
      });
      return sorted(grants.map(({ locationId }) => locationId));
    }

    /** A tenant with a principal site, a second site and one user. */
    async function tenant(tag: string) {
      const organizationId = await organization(tag);
      const principal = await site(organizationId, `${tag}-principal`, true);
      const second = await site(organizationId, `${tag}-second`);
      const userId = await person(tag);
      return { organizationId, principal, second, userId };
    }

    it.each([OrgRole.CASHIER, OrgRole.INVENTORY_USER])(
      'gives a new %s exactly the principal site and no other',
      async (role) => {
        const { organizationId, principal, userId } = await tenant(
          `new-${role.toLowerCase()}`,
        );

        await membership(organizationId, userId, role);

        // Exactly one row, and it is the organization's principal site. The
        // second site of the same tenant exists and is still not granted.
        await expect(grantedIds(organizationId, userId)).resolves.toEqual([
          principal,
        ]);
      },
    );

    it.each([OrgRole.ADMIN])(
      'leaves a new %s without grant rows, because the role is the access',
      async (role) => {
        const { organizationId, userId } = await tenant(
          `wide-${role.toLowerCase()}`,
        );

        await membership(organizationId, userId, role);

        await expect(grantedIds(organizationId, userId)).resolves.toEqual([]);
      },
    );

    it('never grants a site created after the membership exists', async () => {
      const { organizationId, principal, userId } = await tenant('added-site');
      await membership(organizationId, userId, OrgRole.CASHIER);

      await site(organizationId, 'added-site-later');

      await expect(grantedIds(organizationId, userId)).resolves.toEqual([
        principal,
      ]);
    });

    it('leaves an operational membership untouched on another role edit', async () => {
      const { organizationId, principal, second, userId } =
        await tenant('operational-edit');
      await membership(organizationId, userId, OrgRole.CASHIER);
      await prisma.membershipLocation.create({
        data: { organizationId, userId, locationId: second },
      });

      // Both sites are assigned; an operational → operational edit is not a
      // demotion and must not add, replace or drop anything.
      await prisma.organizationUser.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { role: OrgRole.INVENTORY_USER },
      });
      await expect(grantedIds(organizationId, userId)).resolves.toEqual(
        sorted([principal, second]),
      );

      await prisma.organizationUser.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { role: OrgRole.CASHIER, joinedAt: new Date(0) },
      });
      await expect(grantedIds(organizationId, userId)).resolves.toEqual(
        sorted([principal, second]),
      );
    });

    it.each([OrgRole.CASHIER, OrgRole.INVENTORY_USER])(
      'gives the principal site to an %s membership demoted with no grants',
      async (role) => {
        const { organizationId, principal, userId } = await tenant(
          `demoted-${role.toLowerCase()}`,
        );
        await membership(organizationId, userId, OrgRole.ADMIN);
        await expect(grantedIds(organizationId, userId)).resolves.toEqual([]);

        await prisma.organizationUser.update({
          where: { userId_organizationId: { userId, organizationId } },
          data: { role },
        });

        await expect(grantedIds(organizationId, userId)).resolves.toEqual([
          principal,
        ]);
      },
    );

    it('keeps exactly the access a demoted membership already held', async () => {
      const { organizationId, principal, second, userId } = await tenant(
        'demoted-with-grants',
      );
      await membership(organizationId, userId, OrgRole.CASHIER);
      await prisma.membershipLocation.create({
        data: { organizationId, userId, locationId: second },
      });
      // Leaves the membership holding one grant that is not the principal one.
      await prisma.membershipLocation.deleteMany({
        where: { organizationId, userId, locationId: principal },
      });

      await prisma.organizationUser.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { role: OrgRole.ADMIN },
      });
      await expect(grantedIds(organizationId, userId)).resolves.toEqual([
        second,
      ]);

      await prisma.organizationUser.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { role: OrgRole.CASHIER },
      });
      await expect(grantedIds(organizationId, userId)).resolves.toEqual([
        second,
      ]);
    });

    it('grants nothing while the organization has no principal site yet', async () => {
      const organizationId = await organization('no-site');
      const userId = await person('no-site');
      const laterUser = await person('no-site-later');

      // Provisioning order: the membership arrives before its organization's
      // principal site. The insert must succeed and grant nothing.
      await membership(organizationId, userId, OrgRole.CASHIER);
      await expect(grantedIds(organizationId, userId)).resolves.toEqual([]);

      const principal = await site(organizationId, 'no-site-principal', true);
      // Creating the site grants nothing to anybody, not even to the
      // membership that is waiting for it.
      await expect(grantedIds(organizationId, userId)).resolves.toEqual([]);

      // A later membership in the same organization does receive it.
      await membership(organizationId, laterUser, OrgRole.CASHIER);
      await expect(grantedIds(organizationId, laterUser)).resolves.toEqual([
        principal,
      ]);
    });

    it('refuses a grant that points at another organization’s site', async () => {
      const { organizationId, userId } = await tenant('tenant-bound');
      await membership(organizationId, userId, OrgRole.CASHIER);
      const foreign = await tenant('tenant-bound-foreign');

      const rejection = await prisma.membershipLocation
        .create({
          data: {
            organizationId,
            userId,
            locationId: foreign.principal,
          },
        })
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(rejection).not.toBeNull();
      const evidence = `${String((rejection as { code?: unknown })?.code)} ${JSON.stringify(
        (rejection as { meta?: unknown })?.meta ?? {},
      )}`;
      expect(evidence).toMatch(/P2003|23503/);
    });

    it('cascades the organization away while a membership insert is in flight', async () => {
      const organizationId = await organization('delete-insert');
      await site(organizationId, 'delete-insert-principal', true);
      const userId = await person('delete-insert');

      const inserted = deferred();
      const releaseInserter = deferred();
      let inserterPid = 0;
      let deleterPid = 0;
      let grantsInside = 0;

      const inserter = prisma.$transaction(
        async (tx) => {
          inserterPid = await backendPid(tx);
          await tx.organizationUser.create({
            data: { organizationId, userId, role: OrgRole.CASHIER },
          });
          grantsInside = await tx.membershipLocation.count({
            where: { organizationId, userId },
          });
          inserted.release();
          await releaseInserter.wait;
        },
        { timeout: 15000 },
      );

      const deleting = deferred();
      const deleter = prisma.$transaction(
        async (tx) => {
          await inserted.wait;
          deleterPid = await backendPid(tx);
          deleting.release();
          await tx.organization.delete({ where: { id: organizationId } });
        },
        { timeout: 15000 },
      );

      try {
        await Promise.race([deleting.wait, inserter]);
        await expectBlocked(prisma, deleterPid, inserterPid);
        releaseInserter.release();
        // If the deletion deadlocked with the grant insert, one of these
        // rejects with SQLSTATE 40P01 instead of completing.
        await Promise.all([inserter, deleter]);
      } finally {
        releaseInserter.release();
        await Promise.allSettled([inserter, deleter]);
      }

      expect(grantsInside).toBe(1);
      await expect(
        prisma.organizationUser.count({ where: { organizationId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.membershipLocation.count({ where: { organizationId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.location.count({ where: { organizationId } }),
      ).resolves.toBe(0);
    }, 20000);

    it('serializes an organization deletion behind a demotion that writes its grant', async () => {
      const { organizationId, principal, userId } =
        await tenant('delete-demote');
      await membership(organizationId, userId, OrgRole.ADMIN);

      const demoted = deferred();
      const releaseDemoter = deferred();
      let demoterPid = 0;
      let deleterPid = 0;
      let grantsInside: string[] = [];

      // The demotion holds the membership row and, through the trigger, the
      // principal site; the deletion cascades "OrganizationUser" before
      // "Location", so it waits on that row instead of crossing the order.
      const demoter = prisma.$transaction(
        async (tx) => {
          demoterPid = await backendPid(tx);
          await tx.organizationUser.update({
            where: { userId_organizationId: { userId, organizationId } },
            data: { role: OrgRole.CASHIER },
          });
          grantsInside = sorted(
            (
              await tx.membershipLocation.findMany({
                where: { organizationId, userId },
                select: { locationId: true },
              })
            ).map(({ locationId }) => locationId),
          );
          demoted.release();
          await releaseDemoter.wait;
        },
        { timeout: 15000 },
      );

      const deleting = deferred();
      const deleter = prisma.$transaction(
        async (tx) => {
          await demoted.wait;
          deleterPid = await backendPid(tx);
          deleting.release();
          await tx.organization.delete({ where: { id: organizationId } });
        },
        { timeout: 15000 },
      );

      try {
        await Promise.race([deleting.wait, demoter]);
        await expectBlocked(prisma, deleterPid, demoterPid);
        releaseDemoter.release();
        await Promise.all([demoter, deleter]);
      } finally {
        releaseDemoter.release();
        await Promise.allSettled([demoter, deleter]);
      }

      expect(grantsInside).toEqual([principal]);
      await expect(
        prisma.membershipLocation.count({ where: { organizationId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.organizationUser.count({ where: { organizationId } }),
      ).resolves.toBe(0);
    }, 20000);
  },
);

(BACKFILL_DATABASE_URL ? describe : describe.skip)(
  'Principal-site backfill of operational memberships (real PostgreSQL)',
  () => {
    let prisma: PrismaClient;

    const fixture = {
      organizationId: 't3h-backfill-org',
      principal: 't3h-backfill-principal',
      second: 't3h-backfill-secondary',
      cashier: 't3h-backfill-cashier',
      member: 't3h-backfill-member',
      inventory: 't3h-backfill-inventory',
      admin: 't3h-backfill-admin',
      assigned: 't3h-backfill-assigned',
      noSiteOrganizationId: 't3h-backfill-nosite-org',
      noSiteUser: 't3h-backfill-nosite-user',
      otherOrganizationId: 't3h-backfill-other-org',
      otherPrincipal: 't3h-backfill-other-principal',
      elsewhere: 't3h-backfill-elsewhere',
    } as const;

    beforeAll(async () => {
      prisma = new PrismaClient({
        datasourceUrl: disposableDatabase(
          'T3H_BACKFILL_DATABASE_URL',
          BACKFILL_DATABASE_URL!,
        ),
      });
      const prepared = await prisma.organization.count({
        where: { id: fixture.organizationId },
      });
      if (prepared !== 1) {
        throw new Error(
          'The T3h backfill fixture is missing: prepare it on a clone of the pre-migration database before applying 20261125160000_membership_principal_grant',
        );
      }
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    async function grantedIds(organizationId: string, userId: string) {
      const grants = await prisma.membershipLocation.findMany({
        where: { organizationId, userId },
        select: { locationId: true },
      });
      return sorted(grants.map(({ locationId }) => locationId));
    }

    it.each([
      ['CASHIER', 'cashier'],
      ['MEMBER', 'member'],
      ['INVENTORY_USER', 'inventory'],
    ] as const)(
      'gives the principal site to the %s membership that had no grants',
      async (_role, membership) => {
        await expect(
          grantedIds(fixture.organizationId, fixture[membership]),
        ).resolves.toEqual([fixture.principal]);
      },
    );

    it('leaves the administrator membership without grant rows', async () => {
      await expect(
        grantedIds(fixture.organizationId, fixture.admin),
      ).resolves.toEqual([]);
    });

    it('never touches a membership that already held a grant', async () => {
      await expect(
        grantedIds(fixture.organizationId, fixture.assigned),
      ).resolves.toEqual([fixture.second]);
    });

    it('never grants the second site to anybody', async () => {
      const grants = await prisma.membershipLocation.findMany({
        where: { organizationId: fixture.organizationId },
        select: { locationId: true },
      });
      const second = grants.filter(
        ({ locationId }) => locationId === fixture.second,
      );
      expect(second).toHaveLength(1);
    });

    it('leaves an organization without a principal site without grants', async () => {
      await expect(
        grantedIds(fixture.noSiteOrganizationId, fixture.noSiteUser),
      ).resolves.toEqual([]);
      await expect(
        prisma.location.count({
          where: {
            organizationId: fixture.noSiteOrganizationId,
            isDefault: true,
          },
        }),
      ).resolves.toBe(0);
    });

    it('never crosses tenants when backfilling', async () => {
      await expect(
        grantedIds(fixture.otherOrganizationId, fixture.elsewhere),
      ).resolves.toEqual([fixture.otherPrincipal]);
      await expect(
        prisma.membershipLocation.count({
          where: {
            organizationId: fixture.organizationId,
            locationId: fixture.otherPrincipal,
          },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.membershipLocation.count({
          where: {
            organizationId: fixture.otherOrganizationId,
            locationId: fixture.principal,
          },
        }),
      ).resolves.toBe(0);
    });
  },
);
