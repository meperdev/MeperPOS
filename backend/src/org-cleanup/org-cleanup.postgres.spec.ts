import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyCleanup,
  cleanupScopedWhere,
  disableDeleteTriggers,
  enableDeleteTriggers,
  loadCleanupSnapshot,
  loadOrganizationPresence,
  loadProtectedRecounts,
  protectedTableTotals,
  loadRestrictUserReferences,
  loadTableCounts,
  loadTriggerAudit,
  readCleanupIdentity,
  verifyTriggersEnabled,
  type CleanupApplyOptions,
} from './org-cleanup.database';
import {
  DELETE_BLOCKING_TRIGGERS,
  ORG_CLEANUP_STEPS,
  planCleanup,
  planDigest,
  postCommitExitCode,
  protectedNameList,
  triggersToDisable,
  verifySucceeded,
  type CleanupPlan,
} from './org-cleanup.plan';

/**
 * Guarded organization cleanup against a real PostgreSQL database.
 *
 * The suite is skipped unless `ORG_CLEANUP_PG_URL` points at a dedicated,
 * disposable database that already has `prisma migrate deploy` applied. It
 * refuses port 5432 and the development database `inventario_db` by name, so it
 * can never run against the local development data or production.
 *
 * It runs as a NON-SUPERUSER that owns the schema, because that is the only
 * shape production has (Supabase: `postgres` is a plain table owner, and no
 * role may SET `session_replication_role`). Create the roles once, as a
 * superuser, and migrate as the owner:
 *
 *   CREATE ROLE cleanup_owner LOGIN NOSUPERUSER;
 *   CREATE ROLE cleanup_outsider LOGIN NOSUPERUSER;   -- no ownership
 *   CREATE DATABASE cleanup_occ OWNER cleanup_owner;
 *   DATABASE_URL=postgresql://cleanup_owner@127.0.0.1:<port>/cleanup_occ \
 *     npx prisma migrate deploy
 *   ORG_CLEANUP_PG_URL=postgresql://cleanup_owner@127.0.0.1:<port>/cleanup_occ \
 *     npx jest --ci src/org-cleanup
 *
 * `ORG_CLEANUP_NON_OWNER_ROLE` (default `cleanup_outsider`) names the role the
 * "refuses a non-owner" test connects as; it must exist and must not own the
 * tables.
 *
 * Every fixture is shaped like production (L5 of `odd/tasks/test-accounts-reset.md`):
 * a protected "Motors Club" organization with an employee, a WhatsApp session and
 * a member who also belongs to a target organization; two target organizations
 * with employees, payroll obligations, money loans with events, a POS loan
 * intent, an inventory loan, purchase orders, tasks, expenses, sales and stock
 * transfers; a third target-shaped organization holding a fiscal document (the
 * refusal case); and two SuperAdmins.
 *
 * The suite proves: a dry run writes nothing, every refusal fires before a
 * write, an apply removes the targets and only the orphaned users, the shared
 * member keeps its protected membership, the protected counts stay identical,
 * deleting the last active SuperAdmin is refused, and a failure inside the
 * transaction rolls the whole cleanup back.
 */
jest.setTimeout(180_000);

const databaseUrl = process.env.ORG_CLEANUP_PG_URL;

function parseDisposableUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('ORG_CLEANUP_PG_URL must be a postgresql:// URL');
  }
  if (!url.port) {
    throw new Error('ORG_CLEANUP_PG_URL must carry an explicit port');
  }
  if (url.port === '5432') {
    throw new Error('ORG_CLEANUP_PG_URL must not use port 5432');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('ORG_CLEANUP_PG_URL must name a database');
  if (database === 'inventario_db') {
    throw new Error('ORG_CLEANUP_PG_URL must not target inventario_db');
  }
  const host = url.hostname;
  const loopback =
    host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const privateRange =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    (() => {
      const match = /^172\.(\d{1,3})\./.exec(host);
      return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
    })();
  if (!loopback && !privateRange) {
    throw new Error(
      `ORG_CLEANUP_PG_URL host "${host}" is not a local or private address`,
    );
  }
  return url;
}

interface World {
  readonly pro: string;
  readonly basic: string;
  readonly fiscal: string;
  readonly protectedOrg: string;
  readonly proSaleId: string;
  readonly plainOrg: { id: string; name: string; adminEmail: string };
  readonly injectedOrg: { id: string; name: string; adminEmail: string };
  readonly proName: string;
  readonly basicName: string;
  readonly fiscalName: string;
  readonly protectedName: string;
  readonly users: Record<
    | 'proAdmin'
    | 'basicAdmin'
    | 'shared'
    | 'protectedAdmin'
    | 'fiscalAdmin'
    | 'superAdminToDelete'
    | 'superAdminKept',
    { id: string; email: string }
  >;
  readonly targetOrgIds: string[];
}

(databaseUrl ? describe : describe.skip)(
  'organization cleanup (real PostgreSQL)',
  () => {
    const label = `org-cleanup-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let prisma: PrismaClient;
    let world: World;

    beforeAll(async () => {
      const url = parseDisposableUrl(databaseUrl!);
      prisma = new PrismaClient({ datasourceUrl: url.href });
      // The whole point of this suite: a non-superuser table owner, exactly like
      // the Supabase role that runs production migrations.
      const identity = await readCleanupIdentity(prisma);
      const [privileges] = await prisma.$queryRaw<
        { superuser: boolean }[]
      >`SELECT rolsuper AS "superuser" FROM pg_roles WHERE rolname = current_user`;
      expect(privileges.superuser).toBe(false);
      await expect(loadTriggerAudit(prisma)).resolves.toMatchObject({
        role: identity.role,
        missing: [],
        disabled: [],
        unexpected: [],
        unowned: [],
      });
      world = await seedWorld(prisma, label);
    });

    afterAll(async () => {
      if (!prisma) return;
      await tearDownWorld(prisma, world);
      await prisma.$disconnect();
    });

    function nonOwnerUrl(): string {
      const role = process.env.ORG_CLEANUP_NON_OWNER_ROLE ?? 'cleanup_outsider';
      const url = new URL(databaseUrl!);
      url.username = role;
      url.password = '';
      return url.href;
    }

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Waits until PostgreSQL reports a session blocked on the target `Sale`
     * rows. That is the proof that the cleanup reached the delete while the
     * gate transaction still holds the row, so the protected-organization
     * insert really happens *during* the apply.
     */
    async function waitForWaiter(
      db: PrismaClient,
      statement: string,
      timeoutMs: number,
    ): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const rows = await db.$queryRaw<{ waiters: number }[]>`
          SELECT count(*)::int AS "waiters"
          FROM pg_locks l
          JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE NOT l.granted
            AND a.datname = current_database()
            AND a.state = 'active'
            AND a.query LIKE ${statement}`;
        if (Number(rows[0]?.waiters ?? 0) > 0) return;
        if (Date.now() > deadline) {
          throw new Error(
            `the cleanup never blocked on ${statement}; the gate could not hold it`,
          );
        }
        await sleep(25);
      }
    }

    /** The options an apply needs: the digest the dry run printed. */
    function approval(plan: CleanupPlan): CleanupApplyOptions {
      return {
        expectedDigest: planDigest(plan),
        request: {
          orgIds: plan.orgs.map((org) => org.id),
          deleteUserEmails: plan.requestedUsers.map((user) => user.email),
          apply: true,
          confirmation: plan.confirmation,
          protectedNames: plan.protectedNames,
        },
      };
    }

    async function planFor(options: {
      orgIds: string[];
      deleteUserEmails?: string[];
      apply?: boolean;
      confirmation?: string | undefined;
    }) {
      const deleteUserEmails = options.deleteUserEmails ?? [];
      const snapshot = await loadCleanupSnapshot(prisma, {
        orgIds: options.orgIds,
        deleteUserEmails,
      });
      return {
        snapshot,
        plan: planCleanup(
          {
            orgIds: options.orgIds,
            deleteUserEmails,
            apply: options.apply ?? false,
            confirmation: options.confirmation,
            protectedNames: protectedNameList(undefined),
          },
          snapshot,
        ),
      };
    }

    it('plans every organization-scoped table in the schema and reports nothing unplanned', async () => {
      const { snapshot } = await planFor({ orgIds: world.targetOrgIds });

      expect(snapshot.unknownOrgIds).toEqual([]);
      expect(snapshot.targets.map((org) => org.name)).toEqual([
        world.proName,
        world.basicName,
      ]);
      expect(snapshot.unplannedScopedTables).toEqual([]);
      expect(snapshot.targets[0].leftovers.logoUrl).toContain('cloudinary');
      expect(snapshot.targets[0].leftovers.productImages).toHaveLength(1);
      expect(snapshot.targets[0].leftovers.whatsAppConnections).toEqual([
        {
          sessionName: `${label}-pro`,
          channel: 'COMMERCIAL',
          status: 'WORKING',
        },
      ]);
    });

    it('writes nothing on a dry run', async () => {
      const orgCountBefore = await prisma.organization.count();
      const userCountBefore = await prisma.user.count();
      const countsBefore = await loadTableCounts(prisma, world.targetOrgIds);

      const { plan, snapshot } = await planFor({
        orgIds: world.targetOrgIds,
        deleteUserEmails: [world.users.superAdminToDelete.email],
      });

      expect(plan.refusals).toEqual([]);
      expect(
        snapshot.targets[0].counts.find(
          (entry) => entry.table === 'RefreshToken',
        ),
      ).toMatchObject({ label: 'refresh sessions', count: 1 });
      expect(plan.orphans.map((user) => user.email).sort()).toEqual(
        [world.users.proAdmin.email, world.users.basicAdmin.email].sort(),
      );
      expect(plan.requestedUsers.map((user) => user.email)).toEqual([
        world.users.superAdminToDelete.email,
      ]);
      expect(plan.keptUsers.map((user) => user.user.email)).toEqual([
        world.users.shared.email,
      ]);
      expect(plan.keptUsers[0].keptOrganizationNames).toEqual([
        world.protectedName,
      ]);

      expect(await prisma.organization.count()).toBe(orgCountBefore);
      expect(await prisma.user.count()).toBe(userCountBefore);
      expect(await loadTableCounts(prisma, world.targetOrgIds)).toEqual(
        countsBefore,
      );
    });

    it('refuses a protected target and writes nothing', async () => {
      const countsBefore = await loadTableCounts(prisma, [world.protectedOrg]);

      const { plan } = await planFor({
        orgIds: [world.protectedOrg],
        apply: true,
        confirmation: world.protectedName,
      });

      expect(plan.refusals).toContain(
        `organization "Motors Club" is protected and will never be deleted`,
      );
      expect(plan.deleteUsers).toEqual([]);
      expect(
        await prisma.organization.count({ where: { id: world.protectedOrg } }),
      ).toBe(1);
      expect(await loadTableCounts(prisma, [world.protectedOrg])).toEqual(
        countsBefore,
      );
    });

    it('refuses a target that holds a fiscal document, with the count', async () => {
      const { plan } = await planFor({
        orgIds: [world.fiscal],
        apply: true,
        confirmation: world.fiscalName,
      });

      expect(plan.refusals).toContain(
        `target organization "${world.fiscalName}" holds 1 fiscal documents (legal records); refusing`,
      );
      expect(
        await prisma.fiscalDocument.count({
          where: { organizationId: world.fiscal },
        }),
      ).toBe(1);
    });

    it('refuses an unknown organization, an unknown user and a user that keeps another organization', async () => {
      const unknownOrg = await planFor({ orgIds: ['missing-organization'] });
      expect(unknownOrg.plan.refusals).toContain(
        'organization id "missing-organization" does not exist',
      );

      const unknownUser = await planFor({
        orgIds: world.targetOrgIds,
        deleteUserEmails: [`ghost-${label}@example.test`],
      });
      expect(unknownUser.plan.refusals).toContain(
        `user "ghost-${label}@example.test" does not exist`,
      );

      const shared = await planFor({
        orgIds: world.targetOrgIds,
        deleteUserEmails: [world.users.shared.email],
      });
      expect(shared.plan.refusals).toContain(
        `user "${world.users.shared.email}" still belongs to organization "${world.protectedName}", which is not a target; remove that membership first`,
      );
    });

    it('refuses a SuperAdmin delete that would leave zero active SuperAdmins', async () => {
      const both = await planFor({
        orgIds: world.targetOrgIds,
        deleteUserEmails: [
          world.users.superAdminToDelete.email,
          world.users.superAdminKept.email,
        ],
        apply: true,
        confirmation: `${world.proName},${world.basicName}`,
      });

      expect(both.plan.refusals).toContain(
        `user "${world.users.superAdminToDelete.email}" would be the last active SuperAdmin; refusing`,
      );
      expect(both.plan.refusals).toContain(
        `user "${world.users.superAdminKept.email}" would be the last active SuperAdmin; refusing`,
      );
      expect(
        await prisma.organization.count({
          where: { id: { in: world.targetOrgIds } },
        }),
      ).toBe(2);

      // Keeping one of them active makes the other deletable.
      const one = await planFor({
        orgIds: world.targetOrgIds,
        deleteUserEmails: [world.users.superAdminToDelete.email],
        apply: true,
        confirmation: `${world.proName},${world.basicName}`,
      });
      expect(one.plan.refusals).toEqual([]);
    });

    it('refuses an unclassified DELETE trigger, before writing', async () => {
      const { plan } = await planFor({ orgIds: world.targetOrgIds });
      expect(plan.refusals).toEqual([]);

      const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const functionName = `rogue_delete_fn_${suffix}`;
      const triggerName = `rogue_delete_${suffix}`;
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$ BEGIN RETURN OLD; END $$ LANGUAGE plpgsql`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${triggerName}" BEFORE DELETE ON "Sale" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
      );

      try {
        const audit = await loadTriggerAudit(prisma);
        expect(audit.unexpected).toContainEqual({
          table: 'Sale',
          trigger: triggerName,
        });

        const replanned = await planFor({ orgIds: world.targetOrgIds });
        expect(replanned.plan.refusals).toContain(
          `table "Sale" has an unclassified DELETE trigger "${triggerName}"; refusing`,
        );

        // The plan was built before the trigger existed, so only the in-transaction
        // guard can stop this one — and it must stop it before the first delete.
        await expect(
          applyCleanup(prisma, plan, approval(plan)),
        ).rejects.toThrow(/unclassified DELETE trigger/);
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER "${triggerName}" ON "Sale"`,
        );
        await prisma.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
      }

      expect(
        await prisma.organization.count({
          where: { id: { in: world.targetOrgIds } },
        }),
      ).toBe(2);
      await expect(loadTriggerAudit(prisma)).resolves.toMatchObject({
        unexpected: [],
      });
    });

    it('refuses when a listed history trigger is missing', async () => {
      const guard = DELETE_BLOCKING_TRIGGERS.find(
        (entry) => entry.table === 'MoneyLoanEvent',
      )!;
      await prisma.$executeRawUnsafe(
        `ALTER TRIGGER "${guard.trigger}" ON "MoneyLoanEvent" RENAME TO "${guard.trigger}_probe"`,
      );

      try {
        const audit = await loadTriggerAudit(prisma);
        expect(audit.missing).toContainEqual(guard);

        const { plan } = await planFor({ orgIds: world.targetOrgIds });
        expect(plan.refusals).toContain(
          `trigger "${guard.trigger}" on table "MoneyLoanEvent" is missing from this database; refusing`,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TRIGGER "${guard.trigger}_probe" ON "MoneyLoanEvent" RENAME TO "${guard.trigger}"`,
        );
      }

      await expect(loadTriggerAudit(prisma)).resolves.toMatchObject({
        missing: [],
        unexpected: [],
      });
    });

    it('refuses a role that does not own the tables, before writing', async () => {
      const countsBefore = await loadTableCounts(prisma, world.targetOrgIds);
      const ownerSnapshot = await loadCleanupSnapshot(prisma, {
        orgIds: world.targetOrgIds,
        deleteUserEmails: [],
      });
      const { plan } = await planFor({ orgIds: world.targetOrgIds });
      expect(plan.refusals).toEqual([]);

      const outsider = new PrismaClient({ datasourceUrl: nonOwnerUrl() });
      try {
        const [privileges] = await outsider.$queryRaw<
          { superuser: boolean }[]
        >`SELECT rolsuper AS "superuser" FROM pg_roles WHERE rolname = current_user`;
        expect(privileges.superuser).toBe(false);

        const outsiderAudit = await loadTriggerAudit(outsider);
        expect(outsiderAudit.unowned.length).toBeGreaterThan(0);
        expect(outsiderAudit.unowned).toEqual(
          expect.arrayContaining([
            { table: 'MoneyLoanEvent', role: outsiderAudit.role },
          ]),
        );

        const asOutsider = planCleanup(
          {
            orgIds: world.targetOrgIds,
            deleteUserEmails: [],
            apply: false,
            confirmation: undefined,
            protectedNames: protectedNameList(undefined),
          },
          {
            ...ownerSnapshot,
            triggers: outsiderAudit,
          },
        );
        expect(asOutsider.refusals).toContain(
          `role "${outsiderAudit.role}" does not own table "MoneyLoanEvent", so its triggers cannot be disabled; refusing`,
        );

        await expect(
          applyCleanup(outsider, plan, approval(plan)),
        ).rejects.toThrow(/does not own table/);
      } finally {
        await outsider.$disconnect();
      }

      expect(
        await prisma.organization.count({
          where: { id: { in: world.targetOrgIds } },
        }),
      ).toBe(2);
      expect(await loadTableCounts(prisma, world.targetOrgIds)).toEqual(
        countsBefore,
      );
    });

    it('aborts when an approved target is renamed to a protected name between plan and apply', async () => {
      const { plan } = await planFor({ orgIds: [world.basic] });
      expect(plan.refusals).toEqual([]);

      await prisma.organization.update({
        where: { id: world.basic },
        data: { name: 'Motors Club' },
      });
      try {
        await expect(
          applyCleanup(prisma, plan, approval(plan)),
        ).rejects.toThrow(
          /the plan changed since it was approved[\s\S]*is now protected/,
        );
      } finally {
        await prisma.organization.update({
          where: { id: world.basic },
          data: { name: world.basicName },
        });
      }

      expect(
        await prisma.organization.count({ where: { id: world.basic } }),
      ).toBe(1);
      expect(
        await prisma.sale.count({ where: { organizationId: world.basic } }),
      ).toBe(1);
      expect(
        await prisma.user.count({
          where: { email: world.users.basicAdmin.email },
        }),
      ).toBe(1);
      await expect(loadTriggerAudit(prisma)).resolves.toMatchObject({
        disabled: [],
      });
    });

    it('aborts when a to-be-orphaned user gains a membership outside the targets between plan and apply', async () => {
      const { plan } = await planFor({ orgIds: world.targetOrgIds });
      expect(plan.refusals).toEqual([]);
      expect(plan.orphans.map((user) => user.email)).toContain(
        world.users.basicAdmin.email,
      );

      await prisma.organizationUser.create({
        data: {
          userId: world.users.basicAdmin.id,
          organizationId: world.protectedOrg,
          role: 'CASHIER',
        },
      });
      try {
        await expect(
          applyCleanup(prisma, plan, approval(plan)),
        ).rejects.toThrow(/gained a membership outside the targets/);
      } finally {
        await prisma.organizationUser.deleteMany({
          where: {
            userId: world.users.basicAdmin.id,
            organizationId: world.protectedOrg,
          },
        });
      }

      // The user it would have deleted is still there, with its original
      // membership, and no target row was touched.
      expect(
        await prisma.user.count({
          where: { email: world.users.basicAdmin.email },
        }),
      ).toBe(1);
      expect(
        await prisma.organizationUser.count({
          where: { userId: world.users.basicAdmin.id },
        }),
      ).toBe(1);
      expect(
        await prisma.organization.count({
          where: { id: { in: world.targetOrgIds } },
        }),
      ).toBe(2);
    });

    it('refuses an apply whose digest belongs to a dry run that changed', async () => {
      const request = { orgIds: world.targetOrgIds, deleteUserEmails: [] };
      const dry = await planFor(request);
      expect(dry.plan.refusals).toEqual([]);
      const digest = planDigest(dry.plan);

      const newcomer = await prisma.user.create({
        data: {
          email: `${label}-newcomer@example.test`,
          password: PASSWORD,
          name: 'Newcomer',
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: newcomer.id,
          organizationId: world.pro,
          role: 'CASHIER',
        },
      });
      try {
        // What the CLI computes when --apply runs: the plan moved.
        const fresh = await planFor(request);
        expect(planDigest(fresh.plan)).not.toBe(digest);

        await expect(
          applyCleanup(prisma, fresh.plan, {
            ...approval(fresh.plan),
            expectedDigest: digest,
          }),
        ).rejects.toThrow(
          /the plan changed since the dry run; run the dry run again/,
        );
      } finally {
        await prisma.organizationUser.deleteMany({
          where: { userId: newcomer.id },
        });
        await prisma.user.delete({ where: { id: newcomer.id } });
      }

      // Nothing was written and the new member was never deleted.
      expect(
        await prisma.organization.count({
          where: { id: { in: world.targetOrgIds } },
        }),
      ).toBe(2);
      expect(
        await prisma.organizationUser.count({
          where: { userId: world.users.proAdmin.id },
        }),
      ).toBe(1);
    });

    it('never leaves zero active SuperAdmins when the survivor is deactivated concurrently', async () => {
      const { plan } = await planFor({
        orgIds: [world.basic],
        deleteUserEmails: [world.users.superAdminToDelete.email],
      });
      expect(plan.refusals).toEqual([]);

      const other = new PrismaClient({ datasourceUrl: databaseUrl! });
      let lockHeld!: () => void;
      const gateLocked = new Promise<void>((resolve) => {
        lockHeld = resolve;
      });
      const gate = other.$transaction(
        async (tx) => {
          // Deactivates the SuperAdmin the plan keeps, and holds the row lock.
          await tx.user.update({
            where: { id: world.users.superAdminKept.id },
            data: { active: false },
          });
          lockHeld();
          await waitForWaiter(prisma, '%isSuperAdmin%', 15_000);
        },
        { timeout: 60_000, maxWait: 30_000 },
      );

      try {
        await gateLocked;
        await expect(
          applyCleanup(prisma, plan, approval(plan)),
        ).rejects.toThrow();
        await gate;
      } finally {
        await other.$disconnect();
        await prisma.user.update({
          where: { id: world.users.superAdminKept.id },
          data: { active: true },
        });
      }

      // The run aborted instead of deleting the only active SuperAdmin.
      expect(
        await prisma.user.count({
          where: { id: world.users.superAdminToDelete.id },
        }),
      ).toBe(1);
      expect(
        await prisma.user.count({
          where: { isSuperAdmin: true, active: true },
        }),
      ).toBe(2);
      expect(
        await prisma.organization.count({
          where: { id: { in: world.targetOrgIds } },
        }),
      ).toBe(2);
      expect((await verifyTriggersEnabled(prisma)).restored).toBe(true);
    });

    it('does not disable history triggers on tables the target has no rows in', async () => {
      const { plan } = await planFor({ orgIds: [world.plainOrg.id] });
      expect(plan.refusals).toEqual([]);
      expect(triggersToDisable(plan)).toEqual([]);

      const result = await applyCleanup(prisma, plan, approval(plan));

      expect(result.disabledTriggers).toEqual([]);
      expect(result.lockedTables).toContain('Sale');
      expect(result.lockedTables).not.toContain('InventoryMovement');
      expect(result.lockedTables).not.toContain('MoneyLoanEvent');
      expect(
        await prisma.organization.count({ where: { id: world.plainOrg.id } }),
      ).toBe(0);
      expect(
        await prisma.user.count({
          where: { email: world.plainOrg.adminEmail },
        }),
      ).toBe(0);
    });

    it('reports a post-commit verification failure without pretending it rolled back', async () => {
      const { plan } = await planFor({ orgIds: [world.injectedOrg.id] });
      expect(plan.refusals).toEqual([]);

      const result = await applyCleanup(prisma, plan, {
        ...approval(plan),
        verify: () =>
          Promise.resolve({
            targets: [],
            protectedOrgs: [],
            triggers: { restored: true, offenders: [], checked: 16 },
            failures: ['injected post-commit failure'],
          }),
      });

      // The deletion committed; only the verification failed.
      expect(
        await prisma.organization.count({
          where: { id: world.injectedOrg.id },
        }),
      ).toBe(0);
      expect(
        await prisma.user.count({
          where: { email: world.injectedOrg.adminEmail },
        }),
      ).toBe(0);
      expect(result.verification.failures).toEqual([
        'injected post-commit failure',
      ]);
      expect(postCommitExitCode(result.verification)).toBe(2);
      // The real trigger state is still healthy.
      expect((await verifyTriggersEnabled(prisma)).restored).toBe(true);
    });

    it('fails fast when a needed row is locked, leaving everything untouched', async () => {
      const { plan } = await planFor({ orgIds: [world.pro] });
      expect(plan.refusals).toEqual([]);

      const other = new PrismaClient({ datasourceUrl: databaseUrl! });
      let lockHeld!: () => void;
      const gateLocked = new Promise<void>((resolve) => {
        lockHeld = resolve;
      });
      const gate = other.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "Sale" WHERE "organizationId" = ${world.pro} LIMIT 1 FOR SHARE`,
          );
          lockHeld();
          await sleep(1_500);
        },
        { timeout: 30_000, maxWait: 30_000 },
      );

      try {
        await gateLocked;
        await expect(
          applyCleanup(prisma, plan, { ...approval(plan), lockTimeoutMs: 300 }),
        ).rejects.toThrow(/lock timeout|canceling statement/i);
        await gate;
      } finally {
        await other.$disconnect();
      }

      expect(
        await prisma.organization.count({ where: { id: world.pro } }),
      ).toBe(1);
      expect(
        await prisma.sale.count({ where: { organizationId: world.pro } }),
      ).toBe(1);
      expect(
        await prisma.user.count({
          where: { email: world.users.proAdmin.email },
        }),
      ).toBe(1);
      await expect(verifyTriggersEnabled(prisma)).resolves.toMatchObject({
        restored: true,
      });
    });

    it('discovers the RESTRICT foreign keys to User from the catalogue', async () => {
      const discovered = await loadRestrictUserReferences(prisma);

      expect(
        discovered.map((row) => `${row.table}.${row.column}`).sort(),
      ).toEqual(
        [
          'Expense.createdById',
          'InventoryLoan.createdById',
          'InventoryLoanEvent.createdById',
          'InventoryMovement.userId',
          'MoneyLoan.createdById',
          'MoneyLoan.employeeId',
          'MoneyLoanEvent.createdById',
          'PosLoanSaleIntent.initiatedById',
          'PosLoanSaleReservation.finalizedById',
          'PurchaseOrder.createdById',
          'Sale.userId',
          'Task.createdById',
          'TaskEvent.createdById',
        ].sort(),
      );

      // A row like that, outside the targets, refuses the dry run.
      const task = await prisma.task.create({
        data: {
          organizationId: world.protectedOrg,
          title: 'Atribuida fuera de los targets',
          createdById: world.users.proAdmin.id,
        },
      });
      try {
        const { plan } = await planFor({ orgIds: world.targetOrgIds });
        expect(plan.refusals.join(' | ')).toContain('Task: 1');
      } finally {
        await prisma.task.delete({ where: { id: task.id } });
      }
    });

    it('reaches the unknown-organization refusal when every id is unknown', async () => {
      const orgIds = ['missing-one', 'missing-two'];
      const snapshot = await loadCleanupSnapshot(prisma, {
        orgIds,
        deleteUserEmails: [world.users.superAdminKept.email],
      });
      const plan = planCleanup(
        {
          orgIds,
          deleteUserEmails: [world.users.superAdminKept.email],
          apply: false,
          confirmation: undefined,
          protectedNames: protectedNameList(undefined),
        },
        snapshot,
      );

      expect(plan.refusals).toEqual(
        expect.arrayContaining([
          'organization id "missing-one" does not exist',
          'organization id "missing-two" does not exist',
        ]),
      );
    });

    it('runs when no protected organization exists in the database', async () => {
      // A local database seeded only with the test organizations has no
      // Motors Club: the protected lists are empty and must not break the run.
      await expect(
        loadProtectedRecounts(prisma, ['No such organization']),
      ).resolves.toEqual([]);
      await expect(protectedTableTotals(prisma, [])).resolves.toEqual([]);
    });

    it('matches protected organizations with the same normalized identity', async () => {
      const recount = await loadProtectedRecounts(prisma, ['  motors   club ']);

      expect(recount.map((org) => org.id)).toContain(world.protectedOrg);
    });

    it('rolls the whole transaction back when a scoped row survives the plan', async () => {
      const { plan } = await planFor({ orgIds: world.targetOrgIds });
      expect(plan.refusals).toEqual([]);

      const probe = `"CleanupProbe${Math.floor(Math.random() * 1e9)}"`;
      await prisma.$executeRawUnsafe(
        `CREATE TABLE ${probe} ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL)`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${probe} ("id", "organizationId") VALUES ('probe', $1)`,
        world.pro,
      );

      try {
        await expect(
          applyCleanup(prisma, plan, approval(plan)),
        ).rejects.toThrow(/left rows behind/);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TABLE ${probe}`);
      }

      // DDL is transactional too: the triggers disabled inside the failed
      // transaction are back on.
      await expect(verifyTriggersEnabled(prisma)).resolves.toMatchObject({
        restored: true,
        offenders: [],
        checked: 16,
      });
      await expect(loadTriggerAudit(prisma)).resolves.toMatchObject({
        disabled: [],
        unexpected: [],
        missing: [],
      });

      // Nothing was committed: the organizations, their rows and the users are
      // exactly as they were before the failed apply.
      expect(
        await prisma.organization.count({
          where: { id: { in: world.targetOrgIds } },
        }),
      ).toBe(2);
      expect(
        await prisma.product.count({ where: { organizationId: world.pro } }),
      ).toBe(1);
      expect(
        await prisma.sale.count({ where: { organizationId: world.pro } }),
      ).toBe(1);
      expect(
        await prisma.organizationUser.count({
          where: { userId: world.users.proAdmin.id },
        }),
      ).toBe(1);
      expect(
        await prisma.user.count({
          where: { email: world.users.proAdmin.email },
        }),
      ).toBe(1);
    });

    it('applies: targets and orphaned users go, the shared member keeps its protected membership, and a protected sale during the run is information only', async () => {
      const protectedBefore = await loadProtectedRecounts(prisma, [
        world.protectedName,
      ]);
      const protectedBeforeOwn = protectedBefore.find(
        (org) => org.id === world.protectedOrg,
      );
      expect(protectedBeforeOwn).toBeDefined();

      const { plan } = await planFor({
        orgIds: world.targetOrgIds,
        deleteUserEmails: [world.users.superAdminToDelete.email],
        apply: true,
        confirmation: `${world.proName},${world.basicName}`,
      });
      expect(plan.refusals).toEqual([]);
      expect(plan.deleteUsers.map((user) => user.email).sort()).toEqual(
        [
          world.users.proAdmin.email,
          world.users.basicAdmin.email,
          world.users.superAdminToDelete.email,
        ].sort(),
      );

      // Motors Club keeps trading while the cleanup runs. A second connection
      // locks a target sale row, so the apply blocks there after its protected
      // snapshot, and commits a protected sale *during* the run.
      const other = new PrismaClient({ datasourceUrl: databaseUrl! });
      let lockHeld!: () => void;
      const gateLocked = new Promise<void>((resolve) => {
        lockHeld = resolve;
      });
      const gate = other.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "Sale" WHERE "id" = ${world.proSaleId} FOR UPDATE`,
          );
          lockHeld();
          await waitForWaiter(prisma, '%"Sale"%', 15_000);
          await tx.sale.create({
            data: {
              organizationId: world.protectedOrg,
              saleNumber: 50,
              userId: world.users.protectedAdmin.id,
              subtotal: '10.00',
              taxAmount: '0.00',
              total: '10.00',
              amountPaid: '10.00',
              status: 'COMPLETED',
            },
          });
        },
        { timeout: 60_000, maxWait: 30_000 },
      );

      let result: Awaited<ReturnType<typeof applyCleanup>>;
      try {
        await gateLocked;
        result = await applyCleanup(prisma, plan, approval(plan));
        await gate;
      } finally {
        await other.$disconnect();
      }

      expect(result.verification.triggers).toMatchObject({
        restored: true,
        offenders: [],
        checked: 16,
      });
      expect(result.verification.failures).toEqual([]);
      expect(postCommitExitCode(result.verification)).toBe(0);
      expect(result.planDigest).toBe(planDigest(plan));
      expect(result.disabledTriggers.length).toBeGreaterThan(0);
      expect(result.lockedTables).toContain('Sale');
      expect(result.protectedOrgs.changed).toBe(false);
      expect(result.deletedOrganizationIds).toEqual(world.targetOrgIds);
      expect(result.deletedOrphanIds.sort()).toEqual(
        [world.users.proAdmin.id, world.users.basicAdmin.id].sort(),
      );
      expect(result.deletedRequestedIds).toEqual([
        world.users.superAdminToDelete.id,
      ]);

      // Targets and their rows are gone.
      expect(
        await prisma.organization.count({
          where: { id: { in: world.targetOrgIds } },
        }),
      ).toBe(0);
      expect(await loadTableCounts(prisma, world.targetOrgIds)).toEqual(
        ORG_CLEANUP_STEPS.map((step) => ({
          table: step.table,
          label: step.label,
          count: 0,
        })),
      );
      expect(
        await prisma.whatsAppConnection.count({
          where: { organizationId: world.pro },
        }),
      ).toBe(0);

      // Orphans and the requested account are gone; the others survive.
      for (const email of [
        world.users.proAdmin.email,
        world.users.basicAdmin.email,
        world.users.superAdminToDelete.email,
      ]) {
        expect(await prisma.user.count({ where: { email } })).toBe(0);
      }
      for (const email of [
        world.users.shared.email,
        world.users.protectedAdmin.email,
        world.users.fiscalAdmin.email,
        world.users.superAdminKept.email,
      ]) {
        expect(await prisma.user.count({ where: { email } })).toBe(1);
      }

      // Sessions: the tenant-scoped token and the deleted user's token are gone
      // (the second one cascaded with its owner); the protected one survives.
      expect(
        await prisma.refreshToken.count({
          where: { token: `${label}-token-target-org` },
        }),
      ).toBe(0);
      expect(
        await prisma.refreshToken.count({
          where: { token: `${label}-token-deleted-user` },
        }),
      ).toBe(0);
      expect(
        await prisma.refreshToken.count({
          where: { token: `${label}-token-protected` },
        }),
      ).toBe(1);

      // The shared member keeps exactly the protected membership.
      const sharedMemberships = await prisma.organizationUser.findMany({
        where: { userId: world.users.shared.id },
        select: { organizationId: true },
      });
      expect(sharedMemberships).toEqual([
        { organizationId: world.protectedOrg },
      ]);

      // The protected organization and the fiscal organization are untouched,
      // including the money-loan history whose table the targets' cleanup hit.
      expect(
        await prisma.moneyLoan.count({
          where: { organizationId: world.protectedOrg },
        }),
      ).toBe(1);
      expect(
        await prisma.moneyLoanEvent.count({
          where: { organizationId: world.protectedOrg },
        }),
      ).toBe(1);
      expect(
        await prisma.organization.count({ where: { id: world.fiscal } }),
      ).toBe(1);
      expect(
        await prisma.fiscalDocument.count({
          where: { organizationId: world.fiscal },
        }),
      ).toBe(1);
      expect(
        await prisma.sale.count({ where: { organizationId: world.fiscal } }),
      ).toBe(1);

      // The concurrent sale is there, and the post-commit totals differ from
      // the plan-time snapshot — reported as information, never a failure.
      expect(
        await prisma.sale.count({
          where: { organizationId: world.protectedOrg, saleNumber: 50 },
        }),
      ).toBe(1);
      const protectedAfter = await loadProtectedRecounts(prisma, [
        world.protectedName,
      ]);
      const protectedAfterOwn = protectedAfter.find(
        (org) => org.id === world.protectedOrg,
      );
      expect(protectedAfterOwn!.total).toBe(protectedBeforeOwn!.total + 1);

      await expect(verifyTriggersEnabled(prisma)).resolves.toMatchObject({
        restored: true,
        offenders: [],
        checked: 16,
      });
      await expect(loadTriggerAudit(prisma)).resolves.toMatchObject({
        disabled: [],
        missing: [],
        unexpected: [],
        unowned: [],
      });
      const presence = await loadOrganizationPresence(
        prisma,
        world.targetOrgIds,
      );
      expect(presence.every((org) => org.name === null)).toBe(true);
      expect(
        verifySucceeded({
          organizations: presence,
          triggers: {
            checked: result.verification.triggers.checked,
            offenders: result.verification.triggers.offenders,
          },
        }),
      ).toBe(true);
    });

    it('refuses to apply a plan that carries refusals', async () => {
      const { plan } = await planFor({
        orgIds: [world.protectedOrg],
        apply: true,
        confirmation: world.protectedName,
      });

      await expect(applyCleanup(prisma, plan, approval(plan))).rejects.toThrow(
        /refusing to apply a plan that carries refusals/,
      );
    });

    it('runs as a non-superuser owner and leaves the trigger catalogue healthy', async () => {
      const identity = await readCleanupIdentity(prisma);
      const audit = await loadTriggerAudit(prisma);

      expect(identity.database).not.toBe('inventario_db');
      expect(audit.role).toBe(identity.role);
      expect(audit.missing).toEqual([]);
      expect(audit.disabled).toEqual([]);
      expect(audit.unexpected).toEqual([]);
      expect(audit.unowned).toEqual([]);
      expect(audit.found).toEqual(
        expect.arrayContaining(
          DELETE_BLOCKING_TRIGGERS.map((guard) => ({
            table: guard.table,
            trigger: guard.trigger,
            enabled: true,
          })),
        ),
      );
    });
  },
);

// ─── Fixture world ─────────────────────────────────────────────────────────

const PASSWORD = '$2b$10$fixture-only-not-a-real-hash';

async function createUser(
  prisma: PrismaClient,
  label: string,
  key: string,
  options: { superAdmin?: boolean; active?: boolean } = {},
): Promise<{ id: string; email: string }> {
  const email = `${label}-${key}@example.test`;
  const user = await prisma.user.create({
    data: {
      email,
      password: PASSWORD,
      name: `${key} ${label}`,
      isSuperAdmin: options.superAdmin ?? false,
      active: options.active ?? true,
    },
    select: { id: true, email: true },
  });
  return user;
}

async function createBase(
  prisma: PrismaClient,
  label: string,
  name: string,
  options: { logoUrl?: string } = {},
) {
  const organization = await prisma.organization.create({
    data: {
      name,
      slug: `${label}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      logoUrl: options.logoUrl ?? null,
    },
    select: { id: true, name: true },
  });
  const location = await prisma.location.create({
    data: {
      organizationId: organization.id,
      name: 'Principal',
      isDefault: true,
    },
    select: { id: true },
  });
  const warehouse = await prisma.location.create({
    data: {
      organizationId: organization.id,
      name: 'Bodega',
      type: 'WAREHOUSE',
    },
    select: { id: true },
  });
  const category = await prisma.category.create({
    data: { organizationId: organization.id, name: 'General' },
    select: { id: true },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: organization.id,
      categoryId: category.id,
      name: 'Camisa',
      sku: `${label}-${name.slice(0, 6)}-camisa`,
      costPrice: '100.00',
      salePrice: '150.00',
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/camisa.png',
    },
    select: { id: true },
  });
  const customer = await prisma.customer.create({
    data: {
      organizationId: organization.id,
      name: 'Cliente Prueba',
      documentType: 'CC',
      documentNumber: `${label}-${name.slice(0, 6)}`,
    },
    select: { id: true },
  });
  return {
    organization,
    locationId: location.id,
    warehouseId: warehouse.id,
    categoryId: category.id,
    productId: product.id,
    customerId: customer.id,
  };
}

async function createSale(
  prisma: PrismaClient,
  base: {
    organizationId: string;
    locationId: string;
    productId: string;
    customerId: string;
  },
  userId: string,
  saleNumber: number,
) {
  const sale = await prisma.sale.create({
    data: {
      organizationId: base.organizationId,
      saleNumber,
      customerId: base.customerId,
      userId,
      subtotal: '100.00',
      taxAmount: '19.00',
      total: '119.00',
      amountPaid: '119.00',
      status: 'COMPLETED',
    },
    select: { id: true },
  });
  await prisma.saleItem.create({
    data: {
      organizationId: base.organizationId,
      saleId: sale.id,
      productId: base.productId,
      quantity: 1,
      unitPrice: '100.00',
      taxRate: '19.00',
      subtotal: '100.00',
      total: '119.00',
    },
  });
  await prisma.payment.create({
    data: {
      organizationId: base.organizationId,
      saleId: sale.id,
      method: 'CASH',
      amount: '119.00',
    },
  });
  await prisma.saleOriginSite.create({
    data: {
      organizationId: base.organizationId,
      saleId: sale.id,
      locationId: base.locationId,
    },
  });
  return sale;
}

/** A small target with a product and a sale, and no history rows anywhere. */
async function seedPlainOrg(
  prisma: PrismaClient,
  label: string,
  name: string,
): Promise<{ id: string; name: string; adminEmail: string }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const organization = await prisma.organization.create({
    data: { name: `${name} ${label.slice(-6)}`, slug: `${label}-${slug}` },
    select: { id: true, name: true },
  });
  const location = await prisma.location.create({
    data: {
      organizationId: organization.id,
      name: 'Principal',
      isDefault: true,
    },
    select: { id: true },
  });
  const category = await prisma.category.create({
    data: { organizationId: organization.id, name: 'General' },
    select: { id: true },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: organization.id,
      categoryId: category.id,
      name: 'Producto',
      sku: `${label}-${slug}-1`,
      costPrice: '10.00',
      salePrice: '20.00',
    },
    select: { id: true },
  });
  const admin = await createUser(prisma, label, `${slug}-admin`);
  await prisma.organizationUser.create({
    data: {
      organizationId: organization.id,
      userId: admin.id,
      role: 'ADMIN',
      isPrimaryOwner: true,
    },
  });
  await prisma.sale.create({
    data: {
      organizationId: organization.id,
      saleNumber: 1,
      userId: admin.id,
      subtotal: '20.00',
      taxAmount: '0.00',
      total: '20.00',
      amountPaid: '20.00',
      status: 'COMPLETED',
    },
  });
  void location;
  void product;
  return {
    id: organization.id,
    name: organization.name,
    adminEmail: admin.email,
  };
}

async function seedWorld(prisma: PrismaClient, label: string): Promise<World> {
  const proName = `Prueba PRO ${label.slice(-6)}`;
  const basicName = `Prueba BASIC ${label.slice(-6)}`;
  const fiscalName = `Prueba fiscal ${label.slice(-6)}`;

  const proBase = await createBase(prisma, label, proName, {
    logoUrl: 'https://res.cloudinary.com/demo/image/upload/logo-pro.png',
  });
  const basicBase = await createBase(prisma, label, basicName);
  const fiscalBase = await createBase(prisma, label, fiscalName);
  const protectedBase = await createBase(prisma, label, 'Motors Club', {
    logoUrl: 'https://res.cloudinary.com/demo/image/upload/logo-motors.png',
  });

  const users = {
    proAdmin: await createUser(prisma, label, 'pro-admin'),
    basicAdmin: await createUser(prisma, label, 'basic-admin'),
    shared: await createUser(prisma, label, 'shared'),
    protectedAdmin: await createUser(prisma, label, 'motors-admin'),
    fiscalAdmin: await createUser(prisma, label, 'fiscal-admin'),
    superAdminToDelete: await createUser(prisma, label, 'super-one', {
      superAdmin: true,
    }),
    superAdminKept: await createUser(prisma, label, 'super-two', {
      superAdmin: true,
    }),
  } as World['users'];

  await prisma.organizationUser.createMany({
    data: [
      {
        organizationId: proBase.organization.id,
        userId: users.proAdmin.id,
        role: 'ADMIN',
        isPrimaryOwner: true,
      },
      {
        organizationId: proBase.organization.id,
        userId: users.shared.id,
        role: 'CASHIER',
      },
      {
        organizationId: basicBase.organization.id,
        userId: users.basicAdmin.id,
        role: 'ADMIN',
        isPrimaryOwner: true,
      },
      {
        organizationId: protectedBase.organization.id,
        userId: users.protectedAdmin.id,
        role: 'ADMIN',
        isPrimaryOwner: true,
      },
      {
        organizationId: protectedBase.organization.id,
        userId: users.shared.id,
        role: 'CASHIER',
      },
      {
        organizationId: fiscalBase.organization.id,
        userId: users.fiscalAdmin.id,
        role: 'ADMIN',
        isPrimaryOwner: true,
      },
    ],
  });

  // ── Target PRO: every module that the API delete cannot handle ──────────
  const proOrgId = proBase.organization.id;
  const proSale = await createSale(
    prisma,
    { ...proBase, organizationId: proOrgId },
    users.proAdmin.id,
    1,
  );
  // Session rows: one scoped to the target (deleted by the plan), one owned by a
  // deleted user with no organization (cascade) and one that must survive.
  const tokenExpiry = new Date('2027-01-01T00:00:00.000Z');
  await prisma.refreshToken.createMany({
    data: [
      {
        token: `${label}-token-target-org`,
        userId: users.shared.id,
        organizationId: proOrgId,
        expiresAt: tokenExpiry,
      },
      {
        token: `${label}-token-deleted-user`,
        userId: users.proAdmin.id,
        organizationId: null,
        expiresAt: tokenExpiry,
      },
      {
        token: `${label}-token-protected`,
        userId: users.protectedAdmin.id,
        organizationId: protectedBase.organization.id,
        expiresAt: tokenExpiry,
      },
    ],
  });

  const supplier = await prisma.supplier.create({
    data: {
      organizationId: proOrgId,
      name: 'Proveedor Prueba',
      documentNumber: `${label}-nit`,
    },
    select: { id: true },
  });
  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      organizationId: proOrgId,
      orderNumber: 1,
      supplierId: supplier.id,
      createdById: users.proAdmin.id,
      status: 'PENDING',
    },
    select: { id: true },
  });
  await prisma.purchaseOrderItem.create({
    data: {
      organizationId: proOrgId,
      purchaseOrderId: purchaseOrder.id,
      productId: proBase.productId,
      qtyOrdered: 5,
      unitCost: '80.00',
      subtotal: '400.00',
    },
  });

  const task = await prisma.task.create({
    data: {
      organizationId: proOrgId,
      title: 'Revisar inventario',
      createdById: users.proAdmin.id,
      assignedToId: users.proAdmin.id,
    },
    select: { id: true },
  });
  await prisma.taskEvent.create({
    data: {
      organizationId: proOrgId,
      taskId: task.id,
      type: 'CREATED',
      toStatus: 'PENDING',
      createdById: users.proAdmin.id,
    },
  });

  const expenseGroup = await prisma.expenseGroup.create({
    data: { organizationId: proOrgId, name: 'Operación' },
    select: { id: true },
  });
  const expenseLabel = await prisma.expenseLabel.create({
    data: {
      organizationId: proOrgId,
      groupId: expenseGroup.id,
      name: 'Arriendo',
    },
    select: { id: true },
  });
  const expense = await prisma.expense.create({
    data: {
      organizationId: proOrgId,
      labelId: expenseLabel.id,
      supplierId: supplier.id,
      date: new Date('2026-10-01T00:00:00.000Z'),
      total: '50.00',
      status: 'PAID',
      createdById: users.proAdmin.id,
    },
    select: { id: true },
  });
  await prisma.expensePayment.create({
    data: {
      organizationId: proOrgId,
      expenseId: expense.id,
      amount: '50.00',
      method: 'CASH',
      date: new Date('2026-10-02T00:00:00.000Z'),
    },
  });

  const employee = await prisma.employee.create({
    data: { organizationId: proOrgId, name: 'Empleado Prueba' },
    select: { id: true },
  });
  await prisma.employeeShift.create({
    data: {
      organizationId: proOrgId,
      employeeId: employee.id,
      date: new Date('2026-10-05T00:00:00.000Z'),
      kind: 'FULL_DAY',
      amount: '80.00',
    },
  });
  await prisma.payrollObligation.create({
    data: {
      organizationId: proOrgId,
      employeeId: employee.id,
      kind: 'SHIFT_GROUP',
      status: 'PENDING',
    },
  });

  const moneyLoan = await prisma.moneyLoan.create({
    data: {
      organizationId: proOrgId,
      amount: '200.00',
      issuedAt: new Date('2026-10-01T00:00:00.000Z'),
      reason: 'Préstamo de prueba',
      customerId: proBase.customerId,
      createdById: users.proAdmin.id,
    },
    select: { id: true },
  });
  await prisma.moneyLoanEvent.create({
    data: {
      organizationId: proOrgId,
      loanId: moneyLoan.id,
      type: 'CREATED',
      reason: 'Préstamo creado',
      createdById: users.proAdmin.id,
    },
  });
  await prisma.posLoanSaleIntent.create({
    data: {
      organizationId: proOrgId,
      loanId: moneyLoan.id,
      customerId: proBase.customerId,
    },
  });

  const inventoryLoan = await prisma.inventoryLoan.create({
    data: {
      organizationId: proOrgId,
      customerId: proBase.customerId,
      createdById: users.proAdmin.id,
    },
    select: { id: true },
  });
  const inventoryLoanItem = await prisma.inventoryLoanItem.create({
    data: {
      organizationId: proOrgId,
      loanId: inventoryLoan.id,
      productId: proBase.productId,
      quantity: 2,
    },
    select: { id: true },
  });
  await prisma.inventoryLoanEvent.create({
    data: {
      organizationId: proOrgId,
      loanId: inventoryLoan.id,
      itemId: inventoryLoanItem.id,
      type: 'DELIVERED',
      quantity: 2,
      createdById: users.proAdmin.id,
    },
  });

  const transfer = await prisma.stockTransfer.create({
    data: {
      organizationId: proOrgId,
      number: 1,
      fromLocationId: proBase.locationId,
      toLocationId: proBase.warehouseId,
      createdById: users.proAdmin.id,
    },
    select: { id: true },
  });
  await prisma.stockTransferItem.create({
    data: {
      organizationId: proOrgId,
      transferId: transfer.id,
      productId: proBase.productId,
      quantity: 1,
    },
  });

  await prisma.inventoryMovement.create({
    data: {
      organizationId: proOrgId,
      productId: proBase.productId,
      type: 'ADJUSTMENT_IN',
      quantity: 1,
      previousStock: 0,
      newStock: 1,
      reason: 'Carga inicial',
      userId: users.proAdmin.id,
      locationId: proBase.locationId,
    },
  });

  const alarm = await prisma.productStockAlert.create({
    data: {
      organizationId: proOrgId,
      productId: proBase.productId,
      state: 'OPEN',
      stockAtOpen: 1,
      minStockAtOpen: 3,
    },
    select: { id: true },
  });
  await prisma.productStockAlertEvent.create({
    data: {
      organizationId: proOrgId,
      productId: proBase.productId,
      episode: 1,
      kind: 'OPENED',
    },
  });
  void alarm;

  const connection = await prisma.whatsAppConnection.create({
    data: {
      organizationId: proOrgId,
      channel: 'COMMERCIAL',
      sessionName: `${label}-pro`,
      status: 'WORKING',
    },
    select: { id: true },
  });
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      connectionId: connection.id,
      organizationId: proOrgId,
      contactPhone: '573000000001',
      customerId: proBase.customerId,
    },
    select: { id: true },
  });
  await prisma.whatsAppMessage.create({
    data: {
      conversationId: conversation.id,
      providerMessageId: `${label}-msg-1`,
      direction: 'INBOUND',
      source: 'fixture',
      sentAt: new Date('2026-10-02T00:00:00.000Z'),
    },
  });
  await prisma.whatsAppDelivery.create({
    data: {
      connectionId: connection.id,
      kind: 'SCHEDULED',
      reportDate: new Date('2026-10-03T00:00:00.000Z'),
      status: 'SENT',
    },
  });

  // ── Target BASIC: small but non-trivial ─────────────────────────────────
  await createSale(
    prisma,
    { ...basicBase, organizationId: basicBase.organization.id },
    users.basicAdmin.id,
    1,
  );
  await prisma.employee.create({
    data: { organizationId: basicBase.organization.id, name: 'Empleado BASIC' },
  });

  // ── Fiscal organization: refused as a target ────────────────────────────
  const fiscalSale = await createSale(
    prisma,
    { ...fiscalBase, organizationId: fiscalBase.organization.id },
    users.fiscalAdmin.id,
    1,
  );
  await prisma.fiscalDocument.create({
    data: {
      organizationId: fiscalBase.organization.id,
      saleId: fiscalSale.id,
      issuedAt: new Date('2026-10-04T00:00:00.000Z'),
      snapshot: { fixture: true },
    },
  });

  // ── Protected organization: employee, WhatsApp session, sale ────────────
  await createSale(
    prisma,
    { ...protectedBase, organizationId: protectedBase.organization.id },
    users.protectedAdmin.id,
    1,
  );
  await prisma.employee.create({
    data: {
      organizationId: protectedBase.organization.id,
      name: 'Empleado Motors',
    },
  });
  await prisma.whatsAppConnection.create({
    data: {
      organizationId: protectedBase.organization.id,
      channel: 'COMMERCIAL',
      sessionName: `${label}-motors`,
      status: 'STOPPED',
    },
  });
  // History rows guarded by an append-only trigger whose table the targets'
  // cleanup also deletes from: they must survive untouched.
  const protectedLoan = await prisma.moneyLoan.create({
    data: {
      organizationId: protectedBase.organization.id,
      amount: '150.00',
      issuedAt: new Date('2026-09-01T00:00:00.000Z'),
      reason: 'Préstamo de Motors Club',
      customerId: protectedBase.customerId,
      createdById: users.protectedAdmin.id,
    },
    select: { id: true },
  });
  await prisma.moneyLoanEvent.create({
    data: {
      organizationId: protectedBase.organization.id,
      loanId: protectedLoan.id,
      type: 'CREATED',
      reason: 'Préstamo creado',
      createdById: users.protectedAdmin.id,
    },
  });

  // Two throwaway organizations: one without any history rows (the trigger
  // window must stay empty) and one used to force a post-commit failure.
  const plainOrg = await seedPlainOrg(prisma, label, 'Plain Target');
  const injectedOrg = await seedPlainOrg(prisma, label, 'Injected Target');

  return {
    pro: proOrgId,
    proSaleId: proSale.id,
    plainOrg,
    injectedOrg,
    basic: basicBase.organization.id,
    fiscal: fiscalBase.organization.id,
    protectedOrg: protectedBase.organization.id,
    proName,
    basicName,
    fiscalName,
    protectedName: 'Motors Club',
    users,
    targetOrgIds: [proOrgId, basicBase.organization.id],
  };
}

/**
 * Removes every fixture row after the suite. It uses the same trigger
 * mechanism as the tool (disable, delete children first, re-enable) and drops
 * the fiscal document before its sale, which the plan itself never does.
 */
async function tearDownWorld(prisma: PrismaClient, world: World | undefined) {
  if (!world) return;
  const orgIds = [
    world.pro,
    world.basic,
    world.fiscal,
    world.protectedOrg,
  ].filter(Boolean);
  const emails = Object.values(world.users).map((user) => user.email);

  await prisma.$transaction(
    async (tx) => {
      await disableDeleteTriggers(tx);
      await tx.fiscalDocument.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      for (const step of ORG_CLEANUP_STEPS) {
        await tx.$executeRaw(
          Prisma.sql`DELETE FROM ${Prisma.raw(`"${step.table}"`)} WHERE ${cleanupScopedWhere(step.scope, orgIds)}`,
        );
      }
      await enableDeleteTriggers(tx);
      await tx.user.deleteMany({ where: { email: { in: emails } } });
      await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}
