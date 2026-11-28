import { PrismaClient } from '@prisma/client';
import {
  applyCleanup,
  loadCleanupSnapshot,
  loadOrganizationPresence,
  loadProtectedRecounts,
  readCleanupIdentity,
  verifyTriggersEnabled,
} from '../src/org-cleanup/org-cleanup.database';
import {
  CLEANUP_USAGE,
  environmentGateRefusal,
  formatPlanReport,
  formatPostCommitFailure,
  formatProtectedComparison,
  formatRecountSection,
  formatRollbackFailure,
  formatVerifyReport,
  parseCleanupArgs,
  planCleanup,
  planDigest,
  postCommitExitCode,
  protectedNameList,
  verifySucceeded,
} from '../src/org-cleanup/org-cleanup.plan';

/**
 * Guarded organization cleanup CLI.
 *
 * Deletes whole organizations and the users they leave orphaned. It is the only
 * supported way to remove a tenant that holds payroll, loan, POS-loan or
 * reservation history: the API delete translates fiscal documents and nothing
 * else, so those RESTRICT relations make it fail.
 *
 * Safety contract:
 *  - DRY RUN IS THE DEFAULT. Only the literal `--apply` flag writes.
 *  - `--apply` also requires `CLEANUP_CONFIRM` to equal the comma-separated
 *    target names, in the order the `--org` flags were given, AND
 *    `CLEANUP_PLAN_DIGEST` to equal the sha256 the dry run printed. The digest
 *    is re-checked against the plan computed at apply time and against the plan
 *    re-derived under the transaction's locks, so the rows deleted are the rows
 *    the operator approved.
 *  - `Motors Club` and every name in `CLEANUP_PROTECT_ORGS` are refused, and so
 *    is any target that holds a fiscal document (a legal record).
 *  - Outside development/test the run needs `CLEANUP_ALLOW_NON_DEV=true`.
 *  - Every write happens in ONE transaction. The loan, POS-loan and payroll
 *    history triggers reject ordinary deletes, so the transaction disables the
 *    ones whose tables actually hold target rows (`ALTER TABLE ... DISABLE
 *    TRIGGER`) and re-enables them before COMMIT; the foreign keys and every
 *    other trigger stay active. Only a table owner may do that, so the
 *    connecting role must own the trigger tables (true for the Supabase
 *    `postgres` role migrations run as); the run refuses otherwise, before any
 *    write. Those tables are locked ACCESS EXCLUSIVE until COMMIT and the run
 *    uses `lock_timeout` (3s) so a busy table fails fast; run it in a
 *    low-traffic window.
 *  - The transaction is REPEATABLE READ and re-derives the plan from locked
 *    rows before deleting, so a target renamed, a membership granted or a
 *    SuperAdmin change between the dry run and the apply aborts instead of
 *    deleting something the operator never saw.
 *  - Protected-organization totals are compared inside the transaction (that
 *    comparison aborts), and printed after COMMIT as information only: Motors
 *    Club keeps trading while a cleanup runs, and someone else's sale is never
 *    this run's failure.
 *  - A failure before COMMIT prints "failed, transaction rolled back: …" and
 *    exits 1. A failure after COMMIT prints "COMMITTED: …", the trigger SQL to
 *    inspect and fix, and exits 2: the deletion already stands.
 *  - `--verify --org <id>…` is read-only: it reports whether those
 *    organizations are gone and whether every listed trigger is enabled.
 *
 * External leftovers are reported, never deleted: Cloudinary URLs on
 * `Organization.logoUrl` and `Product.imageUrl`, and the WhatsApp session
 * identifiers. No password hash or token is read by this tool.
 */

const prisma = new PrismaClient();
const LOG_PREFIX = '[cleanup-orgs]';

const USAGE = `Usage: ts-node prisma/cleanup-orgs.ts ${CLEANUP_USAGE}

  --org <id>            Target organization id. Repeatable, at least one.
  --delete-user <email> Delete this account too. Repeatable, optional.
  --apply               Actually delete. Without it the run is a dry run.
  --verify              Read-only: are these organizations gone and the
                        triggers enabled? Cannot be combined with --apply.
  --timeout-seconds <n> Transaction timeout, default 60.

Environment:
  CLEANUP_CONFIRM        Required with --apply: the target organization names,
                         comma-separated, in the order of the --org flags.
  CLEANUP_PLAN_DIGEST    Required with --apply: the digest the dry run printed.
  CLEANUP_PROTECT_ORGS   Extra protected organization names, comma-separated.
  CLEANUP_ALLOW_NON_DEV  Must be "true" to run outside development/test.
  DATABASE_URL           The database to clean.`;

function fail(message: string): never {
  console.error(`${LOG_PREFIX} refused: ${message}`);
  process.exit(1);
}

async function runVerify(): Promise<void> {
  const parsed = parseCleanupArgs(process.argv.slice(2));
  if (!parsed.ok) fail(parsed.message);
  const presence = await loadOrganizationPresence(prisma, parsed.args.orgIds);
  const triggers = await verifyTriggersEnabled(prisma);
  const report = {
    organizations: presence,
    triggers: { checked: triggers.checked, offenders: triggers.offenders },
  };
  console.log(formatVerifyReport(report));
  process.exitCode = verifySucceeded(report) ? 0 : 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const parsed = parseCleanupArgs(argv);
  if (!parsed.ok) fail(parsed.message);

  // `--verify` is read-only, so it never needs the non-development override.
  if (parsed.args.verify) {
    await runVerify();
    return;
  }

  const gate = environmentGateRefusal({
    nodeEnv: process.env.NODE_ENV,
    allowNonDev: process.env.CLEANUP_ALLOW_NON_DEV === 'true',
  });
  if (gate) fail(gate);

  const protectedNames = protectedNameList(process.env.CLEANUP_PROTECT_ORGS);

  const identity = await readCleanupIdentity(prisma);
  console.log(
    `${LOG_PREFIX} database "${identity.database}" as role "${identity.role}"`,
  );

  const request = {
    orgIds: parsed.args.orgIds,
    deleteUserEmails: parsed.args.deleteUserEmails,
    apply: parsed.args.apply,
    confirmation: process.env.CLEANUP_CONFIRM,
    protectedNames,
  };
  const snapshot = await loadCleanupSnapshot(prisma, {
    orgIds: parsed.args.orgIds,
    deleteUserEmails: parsed.args.deleteUserEmails,
  });
  const plan = planCleanup(request, snapshot);

  const protectedBefore = await loadProtectedRecounts(prisma, protectedNames);

  console.log(formatPlanReport(plan));

  if (plan.refusals.length > 0) {
    process.exitCode = 1;
    return;
  }

  if (!plan.apply) {
    return;
  }

  // The digest must describe the rows the operator approved in the dry run.
  const digest = planDigest(plan);
  const expectedDigest = process.env.CLEANUP_PLAN_DIGEST?.trim();
  if (!expectedDigest) {
    fail(
      `CLEANUP_PLAN_DIGEST is required with --apply; run the dry run and pass the digest it printed (${digest})`,
    );
  }
  if (expectedDigest !== digest) {
    fail('the plan changed since the dry run; run the dry run again');
  }

  let committed: Awaited<ReturnType<typeof applyCleanup>>;
  try {
    committed = await applyCleanup(prisma, plan, {
      expectedDigest,
      request,
      timeoutSeconds: parsed.args.timeoutSeconds,
    });
  } catch (error) {
    console.error(
      `${LOG_PREFIX} ${formatRollbackFailure(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
    process.exitCode = 1;
    return;
  }

  const rowsDeleted = committed.deletedRows.reduce(
    (total, entry) => total + entry.count,
    0,
  );
  console.log('');
  console.log(
    `${LOG_PREFIX} applied: ${committed.deletedOrganizationIds.length} organization(s), ${committed.deletedOrphanIds.length + committed.deletedRequestedIds.length} user(s), ${rowsDeleted} row(s) deleted in one transaction.`,
  );
  console.log(
    `${LOG_PREFIX} deleted from ${committed.lockedTables.length} table(s); disabled and re-enabled ${committed.disabledTriggers.length} of 16 history trigger(s), whose tables were locked ACCESS EXCLUSIVE until COMMIT.`,
  );

  console.log(
    formatRecountSection(
      'Recount after apply (every target must read 0):',
      committed.verification.targets,
    ),
  );
  console.log(
    "Protected organizations (information only; a concurrent change is not this run's failure):",
  );
  console.log(
    formatProtectedComparison(
      protectedBefore,
      committed.verification.protectedOrgs,
    ),
  );
  console.log(
    `${LOG_PREFIX} protected rows unchanged throughout the transaction: ${committed.protectedOrgs.changed ? 'no' : 'yes'} (${committed.protectedOrgs.before.length} tables checked).`,
  );

  if (committed.verification.failures.length > 0) {
    console.error(
      `${LOG_PREFIX} ${formatPostCommitFailure({
        organizations: committed.deletedOrganizationIds.length,
        users:
          committed.deletedOrphanIds.length +
          committed.deletedRequestedIds.length,
        failures: committed.verification.failures,
      })}`,
    );
    process.exitCode = postCommitExitCode(committed.verification);
    return;
  }

  console.log(
    `${LOG_PREFIX} history triggers re-enabled and verified after commit: ${committed.verification.triggers.checked} checked.`,
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} failed before any write: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
