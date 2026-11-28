import { Prisma, PrismaClient } from '@prisma/client';
import {
  DELETE_BLOCKING_TRIGGERS,
  HARMLESS_DELETE_TRIGGERS,
  ORG_CLEANUP_STEPS,
  lockedTables,
  normalizeOrgName,
  planDigest,
  planDigestOf,
  triggersToDisable,
  type CleanupDeleteUserLookup,
  type CleanupOrgRecord,
  type CleanupOrgSnapshot,
  type CleanupPlan,
  type CleanupPlanDigestFacts,
  type CleanupProtectedRecount,
  type CleanupRecountOrg,
  type CleanupRequest,
  type CleanupScope,
  type CleanupSnapshot,
  type CleanupTableCount,
  type CleanupTableStep,
  type CleanupTriggerAudit,
  type CleanupTriggerGuard,
  type CleanupTriggerState,
  type CleanupUserSnapshot,
} from './org-cleanup.plan';

/**
 * Database half of the organization cleanup.
 *
 * Read-only functions load the snapshot the pure plan needs; `applyCleanup`
 * executes the plan in ONE transaction. The payroll, loan, POS-loan and
 * reservation history tables carry BEFORE DELETE triggers that reject ordinary
 * deletes, and the deployed role (Supabase `postgres`) is a plain table owner
 * that may not touch `session_replication_role`. The transaction therefore
 * disables exactly the listed triggers with `ALTER TABLE ... DISABLE TRIGGER`,
 * deletes the rows with the foreign keys and every other trigger still active,
 * and re-enables them before COMMIT. DDL is transactional, so a rollback
 * restores them; after COMMIT the run re-reads `pg_trigger` and reports any
 * trigger that is not back to `'O'`.
 *
 * The transaction is REPEATABLE READ on purpose. It locks the organizations,
 * the users and the memberships the approved plan depends on, and re-derives
 * every decision from those locked rows before the first delete: a target
 * renamed, a membership granted or a SuperAdmin change aborts instead of
 * deleting something the operator never saw. The same isolation gives the
 * protected-organization comparison a stable snapshot, so a sale committed
 * elsewhere while the cleanup runs cannot make it abort: only writes made by
 * this transaction are visible between its two reads.
 */

export type CleanupDb = PrismaClient | Prisma.TransactionClient;

/**
 * Every foreign key to `User.id` whose delete action is RESTRICT or NO ACTION,
 * discovered from `pg_constraint` instead of a hand-written list (R4). A user
 * that still owns such a row outside the targets cannot be deleted: the plan
 * refuses in the dry run instead of aborting mid-transaction. A new RESTRICT
 * relation is therefore covered the moment the migration lands.
 */
export interface UserForeignKeyReference {
  readonly table: string;
  readonly column: string;
  readonly hasOrganizationId: boolean;
}

export async function loadRestrictUserReferences(
  db: CleanupDb,
): Promise<UserForeignKeyReference[]> {
  const rows = await db.$queryRaw<
    {
      table: string;
      column: string;
      hasOrganizationId: boolean;
    }[]
  >(Prisma.sql`
    SELECT c.relname AS "table",
           a.attname AS "column",
           EXISTS (
             SELECT 1 FROM pg_attribute oa
             WHERE oa.attrelid = c.oid
               AND oa.attname = 'organizationId'
               AND NOT oa.attisdropped
           ) AS "hasOrganizationId"
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_class rt ON rt.oid = con.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    JOIN pg_attribute ra ON ra.attrelid = rt.oid AND ra.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND con.confdeltype IN ('r', 'a')
      AND array_length(con.conkey, 1) = 1
      AND rn.nspname = 'public'
      AND rt.relname = 'User'
      AND ra.attname = 'id'
      AND n.nspname = 'public'
    ORDER BY c.relname, a.attname`);

  return rows.map((row) => ({
    table: row.table,
    column: row.column,
    hasOrganizationId: row.hasOrganizationId,
  }));
}

/**
 * Rows outside the targets that still reference each candidate user through one
 * of the discovered RESTRICT/NO ACTION foreign keys. A table without an
 * `organizationId` column cannot be excluded, so any reference there blocks.
 */
async function loadBlockingReferences(
  db: CleanupDb,
  userIds: readonly string[],
  orgIds: readonly string[],
): Promise<Map<string, { table: string; count: number }[]>> {
  const byUser = new Map<string, { table: string; count: number }[]>();
  if (userIds.length === 0) return byUser;

  for (const reference of await loadRestrictUserReferences(db)) {
    const outside =
      orgIds.length === 0 || !reference.hasOrganizationId
        ? Prisma.sql``
        : Prisma.sql`AND NOT (${organizationIdsIn(orgIds)})`;
    const rows = await db.$queryRaw<{ userId: string; count: number }[]>(
      Prisma.sql`
        SELECT ${identifier(reference.column)} AS "userId", count(*)::int AS "count"
        FROM ${identifier(reference.table)}
        WHERE ${identifier(reference.column)} = ANY(${anyOf(userIds)})
          ${outside}
        GROUP BY 1`,
    );
    for (const row of rows) {
      const entries = byUser.get(row.userId) ?? [];
      entries.push({ table: reference.table, count: Number(row.count) });
      byUser.set(row.userId, entries);
    }
  }
  return byUser;
}

export interface CleanupCommitResult {
  readonly deletedRows: CleanupTableCount[];
  readonly deletedOrganizationIds: string[];
  readonly deletedOrphanIds: string[];
  readonly deletedRequestedIds: string[];
  /** The digest the run was bound to (dry run and apply-time plan). */
  readonly planDigest: string;
  /** Tables rows were deleted from (row locks only; see disabledTriggers for ACCESS EXCLUSIVE). */
  readonly lockedTables: string[];
  /** History triggers disabled during the transaction, and re-enabled. */
  readonly disabledTriggers: CleanupTriggerGuard[];
  /**
   * Protected-organization totals taken inside the transaction, before the
   * first delete and after the last one. `changed` is always false on a
   * committed run: a difference aborts and rolls back.
   */
  readonly protectedOrgs: {
    readonly before: CleanupTableCount[];
    readonly after: CleanupTableCount[];
    readonly changed: boolean;
  };
}

export interface CleanupVerification {
  /** Rows left per target; every total must be zero. */
  readonly targets: CleanupRecountOrg[];
  /** Protected organizations after COMMIT, information only. */
  readonly protectedOrgs: CleanupProtectedRecount[];
  /** Every listed trigger must still exist and be `'O'`. */
  readonly triggers: {
    readonly restored: boolean;
    readonly offenders: CleanupTriggerState[];
    readonly checked: number;
  };
  readonly failures: string[];
}

export type CleanupVerifier = (
  db: PrismaClient,
  plan: CleanupPlan,
  committed: CleanupCommitResult,
) => Promise<CleanupVerification>;

export interface CleanupApplyResult extends CleanupCommitResult {
  /** Post-COMMIT check; failures here mean exit 2, never a rollback. */
  readonly verification: CleanupVerification;
}

export interface CleanupApplyOptions {
  /**
   * The digest the dry run printed. The apply refuses unless it equals the plan
   * computed now AND the one re-derived under the transaction's locks.
   */
  readonly expectedDigest: string;
  /** The request the digest was approved for, re-planned under the locks. */
  readonly request: CleanupRequest;
  /** Transaction timeout in seconds (CLI `--timeout-seconds`, default 60). */
  readonly timeoutSeconds?: number;
  /** `lock_timeout` for the ALTERs and deletes (default 3000 ms). */
  readonly lockTimeoutMs?: number;
  /** Post-COMMIT verifier; tests inject a failing one. */
  readonly verify?: CleanupVerifier;
}

function quotedName(value: string): string {
  // Tables are alphanumeric; trigger names also carry underscores.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`unexpected SQL identifier "${value}"`);
  }
  return `"${value}"`;
}

function identifier(value: string): Prisma.Sql {
  return Prisma.raw(quotedName(value));
}

function anyOf(values: readonly string[]): Prisma.Sql {
  if (values.length === 0) {
    throw new Error('a scoped query needs at least one organization id');
  }
  return Prisma.sql`ARRAY[${Prisma.join(values)}]::text[]`;
}

function organizationIdsIn(orgIds: readonly string[]): Prisma.Sql {
  return Prisma.sql`"organizationId" = ANY(${anyOf(orgIds)})`;
}

/**
 * The exact predicate the count and the delete share, so a dry run can never
 * describe a different set of rows than the run deletes.
 */
export function cleanupScopedWhere(
  scope: CleanupScope,
  orgIds: readonly string[],
): Prisma.Sql {
  switch (scope) {
    case 'organization':
      return organizationIdsIn(orgIds);
    case 'whatsapp-connection':
      return Prisma.sql`"connectionId" IN (SELECT "id" FROM "WhatsAppConnection" WHERE ${organizationIdsIn(orgIds)})`;
    case 'whatsapp-conversation':
      return Prisma.sql`"conversationId" IN (
        SELECT "id" FROM "WhatsAppConversation"
        WHERE ${organizationIdsIn(orgIds)}
          OR "connectionId" IN (SELECT "id" FROM "WhatsAppConnection" WHERE ${organizationIdsIn(orgIds)})
      )`;
    case 'organization-or-whatsapp-connection':
      return Prisma.sql`(${organizationIdsIn(orgIds)} OR "connectionId" IN (SELECT "id" FROM "WhatsAppConnection" WHERE ${organizationIdsIn(orgIds)}))`;
    default: {
      const exhaustive: never = scope;
      throw new Error(`unsupported cleanup scope "${String(exhaustive)}"`);
    }
  }
}

export async function countStepRows(
  db: CleanupDb,
  step: CleanupTableStep,
  orgIds: readonly string[],
): Promise<number> {
  if (orgIds.length === 0) return 0;
  const rows = await db.$queryRaw<{ count: number }[]>(
    Prisma.sql`SELECT count(*)::int AS "count" FROM ${identifier(step.table)} WHERE ${cleanupScopedWhere(step.scope, orgIds)}`,
  );
  return Number(rows[0]?.count ?? 0);
}

/** Per-table rows the plan will delete, in the plan's own order. */
export async function loadTableCounts(
  db: CleanupDb,
  orgIds: readonly string[],
): Promise<CleanupTableCount[]> {
  const counts: CleanupTableCount[] = [];
  for (const step of ORG_CLEANUP_STEPS) {
    counts.push({
      table: step.table,
      label: step.label,
      count: await countStepRows(db, step, orgIds),
    });
  }
  return counts;
}

async function loadOrgSnapshot(
  db: CleanupDb,
  org: CleanupOrgRecord,
): Promise<CleanupOrgSnapshot> {
  const [counts, fiscalDocuments, organization, images, connections] =
    await Promise.all([
      loadTableCounts(db, [org.id]),
      db.fiscalDocument.count({ where: { organizationId: org.id } }),
      db.organization.findUnique({
        where: { id: org.id },
        select: { logoUrl: true },
      }),
      db.product.findMany({
        where: { organizationId: org.id, imageUrl: { not: null } },
        select: { id: true, name: true, imageUrl: true },
        orderBy: { name: 'asc' },
      }),
      db.whatsAppConnection.findMany({
        where: { organizationId: org.id },
        select: { sessionName: true, channel: true, status: true },
        orderBy: { sessionName: 'asc' },
      }),
    ]);

  return {
    id: org.id,
    name: org.name,
    fiscalDocumentCount: fiscalDocuments,
    counts,
    leftovers: {
      logoUrl: organization?.logoUrl ?? null,
      productImages: images.flatMap((image) =>
        image.imageUrl
          ? [
              {
                productId: image.id,
                name: image.name,
                imageUrl: image.imageUrl,
              },
            ]
          : [],
      ),
      whatsAppConnections: connections.map((connection) => ({
        sessionName: connection.sessionName,
        channel: connection.channel,
        status: connection.status,
      })),
    },
  };
}

/** Tables with an `organizationId` column that exist in the connected database. */
export async function listScopedTables(db: CleanupDb): Promise<string[]> {
  const rows = await db.$queryRaw<{ table_name: string }[]>(Prisma.sql`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name = 'organizationId'
    ORDER BY table_name`);
  return rows.map((row) => row.table_name);
}

/**
 * Rows left in org-scoped tables that the plan does not handle. A future table
 * with an `organizationId` therefore refuses the run instead of surviving it.
 */
export async function loadUnplannedScopedTables(
  db: CleanupDb,
  orgIds: readonly string[],
): Promise<{ table: string; count: number }[]> {
  if (orgIds.length === 0) return [];
  const planned = new Set(ORG_CLEANUP_STEPS.map((step) => step.table));
  const unplanned: { table: string; count: number }[] = [];
  for (const table of await listScopedTables(db)) {
    if (planned.has(table)) continue;
    const rows = await db.$queryRaw<{ count: number }[]>(
      Prisma.sql`SELECT count(*)::int AS "count" FROM ${identifier(table)} WHERE ${organizationIdsIn(orgIds)}`,
    );
    const count = Number(rows[0]?.count ?? 0);
    // Only a table that actually holds rows can refuse the run; an empty one
    // is simply part of the schema and will be empty after the delete too.
    if (count > 0) unplanned.push({ table, count });
  }
  return unplanned;
}

/**
 * One snapshot of everything the pure plan needs. Every read is scoped to the
 * requested organization ids or to the candidate user ids; nothing else is
 * touched, and no password column is ever selected.
 */
export async function loadCleanupSnapshot(
  db: CleanupDb,
  request: { orgIds: readonly string[]; deleteUserEmails: readonly string[] },
): Promise<CleanupSnapshot> {
  const organizations = await db.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const byId = new Map(organizations.map((org) => [org.id, org]));

  const targets: CleanupOrgSnapshot[] = [];
  const unknownOrgIds: string[] = [];
  for (const orgId of request.orgIds) {
    const record = byId.get(orgId);
    if (!record) {
      if (!unknownOrgIds.includes(orgId)) unknownOrgIds.push(orgId);
      continue;
    }
    targets.push(await loadOrgSnapshot(db, record));
  }

  const targetIds = targets.map((org) => org.id);
  const candidateEmails = new Set<string>();
  if (targetIds.length > 0) {
    const memberships = await db.organizationUser.findMany({
      where: { organizationId: { in: targetIds } },
      select: { user: { select: { email: true } } },
    });
    for (const membership of memberships) {
      candidateEmails.add(membership.user.email);
    }
  }

  const requestedUsers: {
    email: string;
    user: { id: string } | null;
  }[] = [];
  for (const email of request.deleteUserEmails) {
    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        isSuperAdmin: true,
        active: true,
      },
    });
    requestedUsers.push({ email, user: user ?? null });
    if (user) candidateEmails.add(user.email);
  }

  const candidateRows = await db.user.findMany({
    where: { email: { in: [...candidateEmails] } },
    select: {
      id: true,
      email: true,
      name: true,
      isSuperAdmin: true,
      active: true,
    },
    orderBy: { email: 'asc' },
  });

  const blocking = await loadBlockingReferences(
    db,
    candidateRows.map((user) => user.id),
    targetIds,
  );

  const candidates: CleanupUserSnapshot[] = [];
  for (const user of candidateRows) {
    const memberships = await db.organizationUser.findMany({
      where: { userId: user.id },
      select: { organizationId: true },
    });
    candidates.push({
      ...user,
      memberships,
      blockingReferences: blocking.get(user.id) ?? [],
    });
  }
  const candidatesById = new Map(candidates.map((user) => [user.id, user]));

  const deleteUsers: CleanupDeleteUserLookup[] = requestedUsers.map(
    (entry) => ({
      email: entry.email,
      user: entry.user ? (candidatesById.get(entry.user.id) ?? null) : null,
    }),
  );

  const activeSuperAdmins = await db.user.findMany({
    where: { isSuperAdmin: true, active: true },
    select: { id: true },
  });

  return {
    triggers: await loadTriggerAudit(db),
    organizations,
    targets,
    unknownOrgIds,
    candidates,
    deleteUsers,
    activeSuperAdminIds: activeSuperAdmins.map((user) => user.id),
    unplannedScopedTables: await loadUnplannedScopedTables(db, targetIds),
  };
}

/** Every org-scoped table with a non-zero count for the targets. */
export async function countRemainingScopedRows(
  db: CleanupDb,
  orgIds: readonly string[],
): Promise<{ table: string; count: number }[]> {
  if (orgIds.length === 0) return [];
  const remaining: { table: string; count: number }[] = [];
  for (const table of await listScopedTables(db)) {
    const rows = await db.$queryRaw<{ count: number }[]>(
      Prisma.sql`SELECT count(*)::int AS "count" FROM ${identifier(table)} WHERE ${organizationIdsIn(orgIds)}`,
    );
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) remaining.push({ table, count });
  }
  return remaining;
}

export interface CleanupIdentity {
  readonly role: string;
  readonly database: string;
}

export async function readCleanupIdentity(
  db: CleanupDb,
): Promise<CleanupIdentity> {
  const rows = await db.$queryRaw<CleanupIdentity[]>(Prisma.sql`
    SELECT current_user AS "role", current_database() AS "database"`);
  const identity = rows[0];
  if (!identity) throw new Error('the database returned no identity row');
  return identity;
}

interface RawDeleteTrigger {
  readonly table: string;
  readonly trigger: string;
  readonly enabled: string;
  readonly owner: string;
  /** `pg_table_is_visible`: the relation the unqualified deletes resolve to. */
  readonly visible: boolean;
}

/**
 * Reads every non-internal DELETE trigger on the tables the plan deletes from,
 * compares it with the static guard and reports what would make the run
 * unsafe: a missing listed trigger, a listed trigger that is not enabled, an
 * unclassified DELETE trigger, or a trigger table the connected role does not
 * own (only the owner may run `ALTER TABLE ... DISABLE TRIGGER`).
 */
export async function loadTriggerAudit(
  db: CleanupDb,
): Promise<CleanupTriggerAudit> {
  const role = (await readCleanupIdentity(db)).role;
  const deletedTables = ORG_CLEANUP_STEPS.map((step) => step.table);
  const rows = await db.$queryRaw<RawDeleteTrigger[]>(Prisma.sql`
    SELECT c.relname AS "table",
           t.tgname AS "trigger",
           t.tgenabled AS "enabled",
           pg_get_userbyid(c.relowner) AS "owner",
           pg_table_is_visible(c.oid) AS "visible"
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND (t.tgtype & 8) <> 0
    ORDER BY c.relname, t.tgname`);

  const deleted = new Set(deletedTables);
  // An unqualified `DELETE FROM "Table"` resolves through the search path, so
  // only relations visible from this role are relevant. A table the role cannot
  // see never reaches the deletes either.
  const visibleRows = rows.filter((row) => row.visible);
  const found: CleanupTriggerState[] = visibleRows
    .filter((row) => deleted.has(row.table))
    .map((row) => ({
      table: row.table,
      trigger: row.trigger,
      enabled: row.enabled === 'O',
    }));

  const listed = new Set(
    DELETE_BLOCKING_TRIGGERS.map((guard) => `${guard.table}.${guard.trigger}`),
  );
  const harmless = new Set(
    HARMLESS_DELETE_TRIGGERS.map((guard) => `${guard.table}.${guard.trigger}`),
  );
  const byKey = new Map(
    visibleRows.map((row) => [`${row.table}.${row.trigger}`, row] as const),
  );

  const missing = DELETE_BLOCKING_TRIGGERS.filter(
    (guard) => !byKey.has(`${guard.table}.${guard.trigger}`),
  );
  const disabled = DELETE_BLOCKING_TRIGGERS.filter((guard) => {
    const row = byKey.get(`${guard.table}.${guard.trigger}`);
    return row !== undefined && row.enabled !== 'O';
  });
  const unexpected = visibleRows
    .filter(
      (row) =>
        deleted.has(row.table) &&
        row.enabled === 'O' &&
        !listed.has(`${row.table}.${row.trigger}`) &&
        !harmless.has(`${row.table}.${row.trigger}`),
    )
    .map((row) => ({ table: row.table, trigger: row.trigger }));

  const unowned: { table: string; role: string }[] = [];
  for (const table of new Set(
    DELETE_BLOCKING_TRIGGERS.map((guard) => guard.table),
  )) {
    const triggerRow = visibleRows.find((row) => row.table === table);
    // A missing trigger is already refused; ownership only matters where the
    // ALTER TABLE would run.
    if (!triggerRow) continue;
    if (triggerRow.owner !== role) unowned.push({ table, role });
  }

  return {
    role,
    deletedTables,
    found,
    missing,
    disabled,
    unexpected,
    unowned,
  };
}

/**
 * Turns every listed history trigger off. Callers run it inside the cleanup
 * transaction, after `assertTriggerGuard`: only a table owner may do this, and
 * PostgreSQL keeps the change transactional (a rollback restores every
 * trigger).
 */
export async function disableDeleteTriggers(
  db: CleanupDb,
  guards: readonly CleanupTriggerGuard[] = DELETE_BLOCKING_TRIGGERS,
): Promise<void> {
  for (const guard of guards) {
    await db.$executeRawUnsafe(
      `ALTER TABLE ${quotedName(guard.table)} DISABLE TRIGGER ${quotedName(guard.trigger)}`,
    );
  }
}

/** Turns every listed history trigger back on, before COMMIT. */
export async function enableDeleteTriggers(
  db: CleanupDb,
  guards: readonly CleanupTriggerGuard[] = DELETE_BLOCKING_TRIGGERS,
): Promise<void> {
  for (const guard of guards) {
    await db.$executeRawUnsafe(
      `ALTER TABLE ${quotedName(guard.table)} ENABLE TRIGGER ${quotedName(guard.trigger)}`,
    );
  }
}

/**
 * The in-transaction preflight. It re-reads the catalogue so a plan built a
 * moment ago cannot be applied to a database whose triggers changed, and it
 * runs before the first DDL or row delete.
 */
export async function assertTriggerGuard(
  db: CleanupDb,
): Promise<CleanupTriggerAudit> {
  const audit = await loadTriggerAudit(db);
  const problems: string[] = [];
  for (const guard of audit.missing) {
    problems.push(`trigger "${guard.trigger}" on "${guard.table}" is missing`);
  }
  for (const guard of audit.disabled) {
    problems.push(
      `trigger "${guard.trigger}" on "${guard.table}" is not enabled`,
    );
  }
  for (const guard of audit.unexpected) {
    problems.push(
      `table "${guard.table}" has an unclassified DELETE trigger "${guard.trigger}"`,
    );
  }
  for (const table of audit.unowned) {
    problems.push(`role "${table.role}" does not own table "${table.table}"`);
  }
  if (problems.length > 0) {
    throw new Error(
      `the connected role cannot disable the history triggers safely: ${problems.join('; ')}`,
    );
  }
  return audit;
}

/**
 * Re-reads `pg_trigger` after COMMIT: every listed trigger must still exist and
 * be `'O'`. `checked` is the number of listed triggers actually observed, so
 * the report can print what it verified instead of the static list size.
 */
export async function verifyTriggersEnabled(db: CleanupDb): Promise<{
  restored: boolean;
  offenders: CleanupTriggerState[];
  checked: number;
}> {
  const audit = await loadTriggerAudit(db);
  const offenders = DELETE_BLOCKING_TRIGGERS.flatMap((guard) => {
    const row = audit.found.find(
      (candidate) =>
        candidate.table === guard.table && candidate.trigger === guard.trigger,
    );
    if (!row) return [{ ...guard, enabled: false }];
    return row.enabled ? [] : [row];
  });
  return {
    restored: offenders.length === 0,
    offenders,
    checked: audit.found.filter((row) =>
      DELETE_BLOCKING_TRIGGERS.some(
        (guard) => guard.table === row.table && guard.trigger === row.trigger,
      ),
    ).length,
  };
}

interface LockedOrganizationRow {
  readonly id: string;
  readonly name: string;
}

interface LockedUserRow {
  readonly id: string;
  readonly email: string;
  readonly isSuperAdmin: boolean;
  readonly active: boolean;
}

interface LockedMembershipRow {
  readonly userId: string;
  readonly organizationId: string;
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((value, index) => value === sorted[index]);
}

async function fiscalCountsByOrganization(
  db: CleanupDb,
  orgIds: readonly string[],
): Promise<Map<string, number>> {
  if (orgIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ organizationId: string; count: number }[]>(
    Prisma.sql`SELECT "organizationId", count(*)::int AS "count" FROM "FiscalDocument"
      WHERE "organizationId" = ANY(${anyOf(orgIds)}) GROUP BY "organizationId"`,
  );
  return new Map(rows.map((row) => [row.organizationId, Number(row.count)]));
}

/**
 * Resolves the protected organizations by name, case and whitespace
 * insensitive, the same identity the pure plan uses.
 */
export async function protectedOrganizationIds(
  db: CleanupDb,
  names: readonly string[],
): Promise<string[]> {
  if (names.length === 0) return [];
  const wanted = new Set(names.map((name) => normalizeOrgName(name)));
  const organizations = await db.$queryRaw<LockedOrganizationRow[]>(
    Prisma.sql`SELECT "id", "name" FROM "Organization"`,
  );
  return organizations
    .filter((org) => wanted.has(normalizeOrgName(org.name)))
    .map((org) => org.id)
    .sort();
}

/** Per-table row counts of the protected organizations, on the plan's tables. */
export async function protectedTableTotals(
  db: CleanupDb,
  orgIds: readonly string[],
): Promise<CleanupTableCount[]> {
  // No protected organization in this database (a local one seeded only with
  // the test organizations): nothing to compare.
  if (orgIds.length === 0) return [];
  const counts: CleanupTableCount[] = [];
  for (const step of ORG_CLEANUP_STEPS) {
    counts.push({
      table: step.table,
      label: step.label,
      count: await countStepRows(db, step, orgIds),
    });
  }
  return counts;
}

/**
 * Re-derives every decision of the approved plan from locked rows, inside the
 * cleanup transaction and before the first delete. The plain `FOR UPDATE` locks
 * are also the concurrency guard: a membership grant takes a key share on the
 * `User` and `Organization` rows, so it blocks while this transaction holds
 * them.
 */
export async function lockAndRevalidatePlan(
  db: CleanupDb,
  plan: CleanupPlan,
): Promise<CleanupPlanDigestFacts> {
  const targetIds = plan.orgs.map((org) => org.id);
  const targetIdSet = new Set(targetIds);
  const approvedDelete = new Map(
    plan.deleteUsers.map((user) => [user.id, user] as const),
  );
  const approvedOrphans = new Set(plan.orphans.map((user) => user.id));
  const approvedRequested = new Set(plan.requestedUsers.map((user) => user.id));
  const approvedKept = new Map(
    plan.keptUsers.map((entry) => [entry.user.id, entry.user] as const),
  );
  const planUserIds = [...approvedDelete.keys(), ...approvedKept.keys()];
  const drift: string[] = [];

  // Active SuperAdmins are locked first, survivors included: a concurrent
  // deactivation of the one that must survive either commits before this lock
  // (and the run aborts) or waits until this transaction ends. The rows are
  // read back after the lock, so the survivor check uses the locked state.
  const superAdminsNow = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM "User" WHERE "isSuperAdmin" AND "active" ORDER BY "id" FOR UPDATE`,
  );
  const superAdminIds = superAdminsNow.map((row) => row.id);

  const organizations = await db.$queryRaw<LockedOrganizationRow[]>(
    Prisma.sql`SELECT "id", "name" FROM "Organization" WHERE "id" = ANY(${anyOf(targetIds)}) ORDER BY "id" FOR UPDATE`,
  );
  const organizationsById = new Map(
    organizations.map((org) => [org.id, org] as const),
  );
  for (const org of plan.orgs) {
    const now = organizationsById.get(org.id);
    if (!now) {
      drift.push(`target organization "${org.name}" no longer exists`);
      continue;
    }
    if (now.name !== org.name) {
      drift.push(
        `target organization "${org.name}" is now named "${now.name}"`,
      );
    }
    if (
      plan.protectedNames.some(
        (name) => normalizeOrgName(name) === normalizeOrgName(now.name),
      )
    ) {
      drift.push(`target organization "${now.name}" is now protected`);
    }
  }

  const fiscalNow = await fiscalCountsByOrganization(db, targetIds);
  for (const org of plan.orgs) {
    const count = fiscalNow.get(org.id) ?? 0;
    if (count !== org.fiscalDocumentCount) {
      drift.push(
        `target organization "${org.name}" now holds ${count} fiscal document(s)`,
      );
    }
  }

  const currentMembers = await db.$queryRaw<{ userId: string }[]>(
    Prisma.sql`SELECT DISTINCT "userId" FROM "OrganizationUser" WHERE "organizationId" = ANY(${anyOf(targetIds)})`,
  );
  const candidateIds = [
    ...new Set([...currentMembers.map((row) => row.userId), ...planUserIds]),
  ];

  const users =
    candidateIds.length === 0
      ? []
      : await db.$queryRaw<LockedUserRow[]>(
          Prisma.sql`SELECT "id", "email", "isSuperAdmin", "active" FROM "User"
            WHERE "id" = ANY(${anyOf(candidateIds)}) ORDER BY "id" FOR UPDATE`,
        );
  const usersById = new Map(users.map((user) => [user.id, user] as const));

  const memberships =
    candidateIds.length === 0
      ? []
      : await db.$queryRaw<LockedMembershipRow[]>(
          Prisma.sql`SELECT "userId", "organizationId" FROM "OrganizationUser"
            WHERE "userId" = ANY(${anyOf(candidateIds)})
            ORDER BY "userId", "organizationId" FOR UPDATE`,
        );
  const organizationsOf = new Map<string, string[]>();
  for (const row of memberships) {
    const list = organizationsOf.get(row.userId) ?? [];
    list.push(row.organizationId);
    organizationsOf.set(row.userId, list);
  }

  const allOrganizations = await db.$queryRaw<LockedOrganizationRow[]>(
    Prisma.sql`SELECT "id", "name" FROM "Organization"`,
  );
  const organizationName = new Map(
    allOrganizations.map((org) => [org.id, org.name] as const),
  );
  const describe = (ids: readonly string[]) =>
    ids.map((id) => `"${organizationName.get(id) ?? id}"`).join(', ');
  const outsideTargets = (userId: string) =>
    (organizationsOf.get(userId) ?? []).filter((id) => !targetIdSet.has(id));

  for (const userId of [...approvedOrphans, ...approvedRequested]) {
    const approved = approvedDelete.get(userId);
    const user = usersById.get(userId);
    if (!approved) continue;
    if (!user) {
      drift.push(`user "${approved.email}" no longer exists`);
      continue;
    }
    const outside = outsideTargets(userId);
    if (outside.length > 0) {
      drift.push(
        `user "${user.email}" gained a membership outside the targets (${describe(outside)}), so it would be kept but the approved plan deletes it`,
      );
      continue;
    }
    if (
      approvedOrphans.has(userId) &&
      (organizationsOf.get(userId) ?? []).length === 0
    ) {
      drift.push(
        `user "${user.email}" lost every membership, so it is no longer an orphan`,
      );
    }
  }

  for (const [userId, approved] of approvedKept) {
    const user = usersById.get(userId);
    if (!user) {
      drift.push(`user "${approved.email}" no longer exists`);
      continue;
    }
    if (outsideTargets(userId).length === 0) {
      drift.push(
        `user "${user.email}" no longer belongs to an organization outside the targets, so it would be deleted but the approved plan keeps it`,
      );
    }
  }

  for (const userId of candidateIds) {
    if (
      approvedOrphans.has(userId) ||
      approvedRequested.has(userId) ||
      approvedKept.has(userId)
    ) {
      continue;
    }
    drift.push(
      `"${usersById.get(userId)?.email ?? userId}" became a member of a target organization after the plan was approved`,
    );
  }

  if (!sameIdSet(superAdminIds, plan.activeSuperAdminIds)) {
    drift.push(
      `the set of active SuperAdmins changed since the plan was approved (${plan.activeSuperAdminIds.length} -> ${superAdminIds.length})`,
    );
  }
  if (
    superAdminIds.length > 0 &&
    superAdminIds.every((id) => approvedDelete.has(id))
  ) {
    drift.push(
      'deleting the approved users would leave zero active SuperAdmins',
    );
  }

  if (drift.length > 0) {
    throw new Error(
      `the plan changed since it was approved, so nothing was deleted: ${drift.join('; ')}`,
    );
  }

  // Counts are re-read under the locks: the target organizations are locked, so
  // no child row can be inserted, and REPEATABLE READ keeps a concurrent delete
  // out of the snapshot. These are the counts the digest is verified against.
  const orgs: Array<{
    id: string;
    name: string;
    counts: Array<{ table: string; count: number }>;
  }> = [];
  for (const org of plan.orgs) {
    const counts = await loadTableCounts(db, [org.id]);
    orgs.push({
      id: org.id,
      name: organizationsById.get(org.id)?.name ?? org.name,
      counts: counts.map((entry) => ({
        table: entry.table,
        count: entry.count,
      })),
    });
  }

  return {
    orgs,
    deleteUsers: plan.deleteUsers
      .map((user) => ({
        id: user.id,
        email: user.email,
        kind: approvedOrphans.has(user.id)
          ? ('orphan' as const)
          : ('requested' as const),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    keptUsers: plan.keptUsers.map((entry) => entry.user.id).sort(),
  };
}

/**
 * Executes an approved plan in ONE REPEATABLE READ transaction:
 *  0. refuse unless the plan still carries the digest the dry run printed;
 *  1. bound the lock wait (`lock_timeout`) so a busy table fails fast instead
 *     of queueing every writer behind the ALTERs;
 *  2. re-read the trigger catalogue;
 *  3. lock the active SuperAdmins, the target organizations and the plan's
 *     users and memberships, then re-derive every decision — any difference
 *     from the approved plan aborts before a single row is deleted;
 *  4. re-derive the plan digest under those locks: it must equal the approved
 *     digest, so a dry run and its apply cannot describe different rows;
 *  5. count the protected organizations on the plan's tables;
 *  6. disable only the history triggers of tables that actually have rows, then
 *     delete every scoped row in the plan's children-first order;
 *  7. verify no org-scoped row is left, re-enable the triggers and re-count the
 *     protected organizations (a difference is this transaction's own doing);
 *  8. delete the organizations, the orphaned users and the requested users;
 *  9. COMMIT, then run the post-commit verification. A verification failure is
 *     returned, never thrown: the deletion already stands.
 */
export async function applyCleanup(
  db: PrismaClient,
  plan: CleanupPlan,
  options: CleanupApplyOptions,
): Promise<CleanupApplyResult> {
  if (plan.refusals.length > 0) {
    throw new Error('refusing to apply a plan that carries refusals');
  }
  const orgIds = plan.orgs.map((org) => org.id);
  if (orgIds.length === 0) {
    throw new Error('refusing to apply a plan without target organizations');
  }
  const approvedDigest = planDigest(plan);
  if (options.expectedDigest.trim() !== approvedDigest) {
    throw new Error(
      'the plan changed since the dry run; run the dry run again',
    );
  }
  const orphanIds = plan.orphans.map((user) => user.id);
  const requestedIds = plan.requestedUsers.map((user) => user.id);
  const lockTimeoutMs = Math.trunc(options.lockTimeoutMs ?? 3_000);
  if (!(lockTimeoutMs > 0) || !Number.isFinite(lockTimeoutMs)) {
    throw new Error('lockTimeoutMs must be a positive number of milliseconds');
  }
  const guardsToDisable = triggersToDisable(plan);
  const tablesToLock = lockedTables(plan);

  const committed = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`,
      );
      await assertTriggerGuard(tx);

      const lockedFacts = await lockAndRevalidatePlan(tx, plan);
      if (planDigestOf(lockedFacts) !== approvedDigest) {
        throw new Error(
          'the plan changed since the dry run; run the dry run again',
        );
      }

      const protectedOrgs = await protectedOrganizationIds(
        tx,
        plan.protectedNames,
      );
      const protectedBefore = await protectedTableTotals(tx, protectedOrgs);

      await disableDeleteTriggers(tx, guardsToDisable);

      const deletedRows: CleanupTableCount[] = [];
      for (const step of ORG_CLEANUP_STEPS) {
        const affected = await tx.$executeRaw(
          Prisma.sql`DELETE FROM ${identifier(step.table)} WHERE ${cleanupScopedWhere(step.scope, orgIds)}`,
        );
        deletedRows.push({
          table: step.table,
          label: step.label,
          count: Number(affected),
        });
      }

      const remaining = await countRemainingScopedRows(tx, orgIds);
      if (remaining.length > 0) {
        throw new Error(
          `the cleanup plan left rows behind: ${remaining
            .map((entry) => `${entry.table} (${entry.count})`)
            .join(', ')}`,
        );
      }

      await enableDeleteTriggers(tx, guardsToDisable);

      const protectedAfter = await protectedTableTotals(tx, protectedOrgs);
      const protectedDrift = protectedBefore
        .map((entry, index) => ({
          label: entry.label,
          before: entry.count,
          after: protectedAfter[index]?.count ?? 0,
        }))
        .filter((entry) => entry.before !== entry.after);
      if (protectedDrift.length > 0) {
        throw new Error(
          `the cleanup changed a protected organization, so nothing was deleted: ${protectedDrift
            .map((entry) => `${entry.label} ${entry.before} -> ${entry.after}`)
            .join(', ')}`,
        );
      }

      await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      if (orphanIds.length > 0) {
        await tx.user.deleteMany({ where: { id: { in: orphanIds } } });
      }
      if (requestedIds.length > 0) {
        await tx.user.deleteMany({ where: { id: { in: requestedIds } } });
      }

      return {
        deletedRows,
        deletedOrganizationIds: orgIds,
        deletedOrphanIds: orphanIds,
        deletedRequestedIds: requestedIds,
        planDigest: approvedDigest,
        lockedTables: tablesToLock,
        disabledTriggers: guardsToDisable,
        protectedOrgs: {
          before: protectedBefore,
          after: protectedAfter,
          // Always false on a committed run: a difference throws above.
          changed: protectedDrift.length > 0,
        },
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: Math.max(1, Math.trunc(options.timeoutSeconds ?? 60)) * 1_000,
      maxWait: 30_000,
    },
  );

  const verifier = options.verify ?? verifyCleanup;
  let verification: CleanupVerification;
  try {
    verification = await verifier(db, plan, committed);
  } catch (error) {
    // The COMMIT already happened: report, never pretend it rolled back.
    verification = {
      targets: [],
      protectedOrgs: [],
      triggers: { restored: false, offenders: [], checked: 0 },
      failures: [
        `the post-commit verification crashed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  return { ...committed, verification };
}

/**
 * Post-COMMIT verification. The targets must hold no rows and every listed
 * trigger must be back to `'O'`; the protected totals are informational.
 */
export async function verifyCleanup(
  db: CleanupDb,
  plan: CleanupPlan,
): Promise<CleanupVerification> {
  const targets = await loadRecount(db, plan.orgs);
  const protectedOrgs = await loadProtectedRecounts(db, plan.protectedNames);
  const triggers = await verifyTriggersEnabled(db);
  const failures: string[] = [];
  for (const org of targets) {
    if (org.total > 0)
      failures.push(`${org.name} still holds ${org.total} rows`);
  }
  if (!triggers.restored) {
    failures.push(
      `history triggers still disabled after commit: ${triggers.offenders
        .map((row) => `${row.table}.${row.trigger}`)
        .join(', ')}`,
    );
  }
  return { targets, protectedOrgs, triggers, failures };
}

/** Read-only `--verify` support: which of these organizations still exist. */
export async function loadOrganizationPresence(
  db: CleanupDb,
  ids: readonly string[],
): Promise<{ id: string; name: string | null }[]> {
  if (ids.length === 0) return [];
  const rows = await db.$queryRaw<{ id: string; name: string }[]>(
    Prisma.sql`SELECT "id", "name" FROM "Organization" WHERE "id" = ANY(${anyOf(ids)})`,
  );
  const byId = new Map(rows.map((row) => [row.id, row.name] as const));
  return ids.map((id) => ({ id, name: byId.get(id) ?? null }));
}

/** Recounts a set of organizations by id, for the post-apply verification. */
export async function loadRecount(
  db: CleanupDb,
  orgs: ReadonlyArray<CleanupOrgRecord>,
): Promise<
  {
    orgId: string;
    name: string;
    counts: CleanupTableCount[];
    total: number;
  }[]
> {
  const recount: {
    orgId: string;
    name: string;
    counts: CleanupTableCount[];
    total: number;
  }[] = [];
  for (const org of orgs) {
    const counts = await loadTableCounts(db, [org.id]);
    recount.push({
      orgId: org.id,
      name: org.name,
      counts,
      total: counts.reduce((sum, entry) => sum + entry.count, 0),
    });
  }
  return recount;
}

/**
 * Row totals for the protected organizations, counted before and after an
 * apply so the run can prove it never touched them.
 */
export async function loadProtectedRecounts(
  db: CleanupDb,
  names: readonly string[],
): Promise<CleanupProtectedRecount[]> {
  if (names.length === 0) return [];
  // Same normalized identity the in-transaction check uses (`protectedOrganizationIds`),
  // so the information printed after COMMIT names exactly the organizations the
  // transaction compared.
  const ids = await protectedOrganizationIds(db, names);
  if (ids.length === 0) return [];
  const organizations = await db.$queryRaw<LockedOrganizationRow[]>(
    Prisma.sql`SELECT "id", "name" FROM "Organization" WHERE "id" = ANY(${anyOf(ids)}) ORDER BY "name"`,
  );
  const recount: CleanupProtectedRecount[] = [];
  for (const org of organizations) {
    const counts = await loadTableCounts(db, [org.id]);
    recount.push({
      id: org.id,
      name: org.name,
      counts,
      total: counts.reduce((sum, entry) => sum + entry.count, 0),
    });
  }
  return recount;
}
