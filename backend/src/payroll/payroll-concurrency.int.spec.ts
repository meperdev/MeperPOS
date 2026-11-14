import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeShiftKind,
  OrgRole,
  PaymentMethod,
  PlanType,
  Prisma,
} from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CacheService } from '../common/services/cache.service';
import {
  parseBogotaEndOfDay,
  parseBogotaStartOfDay,
} from '../common/utils/bogota-date';
import { ExpensesService } from '../expenses/expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { writePayrollCompletionExpense } from './payroll-completed-expense-writer';
import { resolvePayrollExpenseCategoryWithin } from './payroll-expense-category.service';
import { PayrollGroupInstallmentCorrectionService } from './payroll-group-installment-correction.service';
import { PayrollGroupInstallmentsService } from './payroll-group-installments.service';
import { PayrollGroupsService } from './payroll-groups.service';
import type { PayrollObligationCompletionFacts } from './payroll-obligation-completion';
import { PayrollObligationsService } from './payroll-obligations.service';
import { PayrollPeriodInstallmentCorrectionService } from './payroll-period-installment-correction.service';
import { PayrollPeriodInstallmentsService } from './payroll-period-installments.service';
import { PayrollPeriodsService } from './payroll-periods.service';
import { PayrollReplacementPaymentService } from './payroll-replacement-payment.service';

/**
 * Opt-in PostgreSQL proof for the payroll claims that the mocked specs can only
 * argue statically (T5 S4, S5, S6, S8):
 *
 * 1. two concurrent completing installments on the same pending obligation
 *    cannot both complete it (one cash outflow, one expense, one link);
 * 2. a failing expense write rolls back the cash outflow, the installment, the
 *    allocations and the obligation status, leaving the payment pending;
 * 3. the expense API guard really waits on the same `Expense ... FOR UPDATE` row
 *    lock the completion's replay verification holds, then refuses the edit, and
 *    never allows an edit afterwards;
 * 4. cash-flow aggregation counts a payroll outflow once and excludes its
 *    mirrored `ExpensePayment`;
 * 5. the production employee-first lock order cannot form an AB-BA cycle with
 *    itself, while an intentional reverse-order AB-BA is a real PostgreSQL
 *    deadlock (40P01) that Prisma surfaces; the victim leaves no partial cash,
 *    expense or link and the payment still commits exactly once;
 * 6. what actually happens when a lock waiter outlives Prisma's interactive
 *    transaction timeout: the observed error code, nothing written, and a clean
 *    retry afterwards;
 * 7. the taxonomy-deactivation race the writer documents, for both taxonomy rows
 *    it now locks: a label or group deactivation committed between the category
 *    read and the expense write fails the completion closed, and a deactivation
 *    that is already in flight when the writer asks for its `ExpenseGroup` +
 *    `ExpenseLabel ... FOR UPDATE` lock statement serializes with it, so the completion
 *    fails closed instead of committing an expense bound to inactive taxonomy;
 * 8. cross-tenant isolation between two namespaced fixture organizations for
 *    the obligation, installment, cash and expense rows these paths own;
 * 9. two concurrent corrections of one grouped installment: exactly one applies,
 *    and the loser leaves no void, no replacement application, no revision, no
 *    cash change and no status change behind;
 * 10. a grouped correction whose completion expense write fails writes nothing at
 *    all, and a failure that happens *after* the expense and cash work of the same
 *    transaction is discarded by PostgreSQL, so no money survives it;
 * 11. two concurrent reference-based replacements of the same source installment:
 *    exactly one succeeds, and the other is refused without a second obligation,
 *    reference or cash row;
 * 12. a replacement whose referenced cash plus its completing installment reaches
 *    COMPLETED exactly once, writing one expense when the stored choice is enabled
 *    and none when it is disabled;
 * 13. a probe of the `Organization` KEY SHARE -> FOR UPDATE upgrade between two
 *    expense-writing completions of *different* employees in one tenant: the
 *    outcome PostgreSQL produces is asserted, whichever side it kills.
 *
 * Opt-in on purpose: ordinary `npm test` runs must never touch a database.
 * The suite is skipped unless `PAYROLL_PG_INT=1`.
 *
 * Safety, in this order:
 * - `beforeAll` fails closed unless `current_database()` is the local development
 *   database `inventario_db`, the server address is loopback/private, and the
 *   connecting role may set `session_replication_role` (needed by the cleanup);
 * - every fixture row is namespaced by a unique organization slug/e-mail and is
 *   deleted by `organizationId`/`userId` only, never by a table-wide delete;
 * - cleanup runs in one transaction with `session_replication_role = replica`
 *   because the payroll history tables carry append-only BEFORE UPDATE/DELETE
 *   triggers, including foreign-key constraint triggers; cleanup is scoped to
 *   fixture organization IDs and uses children-first order;
 * - pre-existing row counts are captured before the fixtures and compared after
 *   cleanup: nothing may disappear.
 *
 * What this file proves, and what it still cannot, is stated at the bottom of the
 * spec and repeated in the handoff.
 */
const ENABLED = process.env.PAYROLL_PG_INT === '1';
const describePostgres = ENABLED ? describe : describe.skip;

/** The only database this suite is allowed to write to. */
const REQUIRED_DATABASE = 'inventario_db';

// Fixed dates keep each scenario inside its own reporting window, so the shared
// development database's own rows can never satisfy an assertion by accident.
const DATE_CONCURRENT = '2026-04-10';
const DATE_ROLLBACK = '2026-05-10';
const DATE_CASH_FLOW = '2026-06-10';
const CASH_FLOW_START = '2026-06-01';
const CASH_FLOW_END = '2026-06-30';

const PERIOD_TOTAL = '100.00';
const GROUP_TOTAL = '300.00';
const CASH_FLOW_TOTAL = '50.00';
const CONTROL_EXPENSE_TOTAL = '20.00';

// Scenarios 5-8 keep their own dates and amounts, so each one's rows are
// identifiable and disjoint from the scenarios above.
const DATE_DEADLOCK = '2026-08-10';
const DATE_INTRUDER = '2026-08-11';
const DATE_TIMEOUT = '2026-09-10';
const DATE_TAXONOMY = '2026-07-10';
const DATE_ISOLATION = '2026-10-05';

const DEADLOCK_TOTAL_A = '70.00';
const DEADLOCK_TOTAL_B = '80.00';
const INTRUDER_TOTAL = '90.00';
const TIMEOUT_TOTAL = '10.00';
const TAXONOMY_TOTAL_BEFORE_WRITE = '40.00';
const TAXONOMY_TOTAL_AFTER_WRITE = '30.00';
const TAXONOMY_TOTAL_AFTER_GROUP_WRITE = '20.00';
const ISOLATION_TOTAL_A = '60.00';

// Scenarios 9-13 own their employees, dates and amounts, so their rows stay
// disjoint from every scenario above and from each other.
const DATE_CORRECTION_CONCURRENT = '2026-11-05';
const DATE_CORRECTION_ROLLBACK = '2026-12-05';
const DATE_CORRECTION_TIMEOUT = '2027-01-05';
const DATE_REPLACEMENT_RACE = '2027-02-05';
const DATE_REPLACEMENT_RACE_LATER = '2027-02-06';
const DATE_REPLACEMENT_SOURCE = '2027-03-05';
const DATE_REPLACEMENT_SOURCE_LATER = '2027-03-06';
const DATE_REPLACEMENT_COMPLETE_WITH_EXPENSE = '2027-03-10';
const DATE_REPLACEMENT_COMPLETE_WITHOUT_EXPENSE = '2027-03-11';
const DATE_ORGANIZATION_LOCK_PROBE = '2027-04-10';

// Grouped shifts are 110.00 each, so every grouped payment here totals 220.00:
// an amount no other scenario of this suite uses.
const GROUPED_SHIFT_AMOUNT = '110.00';
const GROUPED_TOTAL = '220.00';
const CORRECTION_FIRST_TOTAL = '75.00';
const REPLACEMENT_FIRST_TOTAL = '65.00';
const REPLACEMENT_SECOND_TOTAL = '155.00';
const ORGANIZATION_PROBE_TOTAL_A = '45.00';
const ORGANIZATION_PROBE_TOTAL_B = '55.00';
const ISOLATION_TOTAL_B_PENDING = '100.00';
const ISOLATION_PAID_B = '40.00';
const ISOLATION_TOTAL_B_COMPLETED = '50.00';
// The writer never validates the ids inside the facts it is handed (a documented
// precondition), so these two opaque placeholders identify the test-owned facts
// of scenario 7. They are never persisted as a `PayrollCashOutflow`.
const TEST_OWNED_OUTFLOW_A = 'test-owned-outflow-taxonomy-before-write';
const TEST_OWNED_OUTFLOW_B = 'test-owned-outflow-taxonomy-after-write';
const TEST_OWNED_OUTFLOW_C = 'test-owned-outflow-taxonomy-after-group-write';

interface DatabaseIdentity {
  db: string;
  host: string;
  usr: string;
  superuser: boolean;
}

function isLoopbackOrPrivate(host: string): boolean {
  if (host === 'local' || host === '127.0.0.1' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  // 172.16.0.0/12 (the docker bridge network of the local compose stack).
  const private172 = /^172\.(\d{1,3})\./.exec(host);
  if (private172) {
    const second = Number(private172[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

/**
 * Fail closed before any fixture exists: the suite must never be pointed at a
 * production database, and cleanup needs the privilege the history triggers
 * otherwise deny.
 */
async function assertLocalDevelopmentDatabase(
  prisma: PrismaService,
): Promise<void> {
  const [identity] = await prisma.$queryRaw<DatabaseIdentity[]>`
    SELECT current_database() AS db,
           COALESCE(host(inet_server_addr()), 'local') AS host,
           current_user AS usr,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`;

  if (!identity) throw new Error('No database identity was returned');
  if (identity.db !== REQUIRED_DATABASE)
    throw new Error(
      `Refusing to run: PAYROLL_PG_INT targets "${identity.db}", expected the local development database "${REQUIRED_DATABASE}"`,
    );
  if (!isLoopbackOrPrivate(identity.host))
    throw new Error(
      `Refusing to run: server address "${identity.host}" is not a local or private address`,
    );
  if (!identity.superuser)
    throw new Error(
      `Refusing to run: role "${identity.usr}" cannot set session_replication_role, so the append-only payroll history triggers would leave fixture rows behind`,
    );
}

/**
 * Waits until PostgreSQL itself reports a session blocked on a row lock while
 * running a statement against `"Expense"`.
 *
 * This is the evidence that the expense API guard is *waiting*, not merely slow:
 * `pg_locks` shows the ungranted transactionid lock and `pg_stat_activity` shows
 * the waiting statement. The lock owner is idle-in-transaction at that point, so
 * the `query` filter cannot match the holder.
 */
async function waitForExpenseLockWaiter(
  probe: PrismaService,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await probe.$queryRaw<{ waiters: number }[]>`
      SELECT count(*)::int AS waiters
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted
        AND l.locktype = 'transactionid'
        AND a.datname = current_database()
        AND a.state = 'active'
        AND a.wait_event_type = 'Lock'
        AND a.query LIKE '%"Expense"%'`;
    const waiters = Number(rows[0]?.waiters ?? 0);
    if (waiters > 0) return waiters;
    if (Date.now() > deadline)
      throw new Error(
        `No PostgreSQL lock wait on "Expense" was observed within ${timeoutMs}ms`,
      );
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Same evidence for any payroll row: an ungranted `transactionid` lock on a
 * backend whose current statement names the given relation. The relation is
 * passed as a LIKE pattern so the caller states exactly what it waits for.
 */
async function waitForLockWaiter(
  probe: PrismaService,
  relationPattern: string,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await probe.$queryRaw<{ waiters: number }[]>`
      SELECT count(*)::int AS waiters
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted
        AND l.locktype = 'transactionid'
        AND a.datname = current_database()
        AND a.state = 'active'
        AND a.wait_event_type = 'Lock'
        AND a.query LIKE ${relationPattern}`;
    const waiters = Number(rows[0]?.waiters ?? 0);
    if (waiters > 0) return waiters;
    if (Date.now() > deadline)
      throw new Error(
        `No PostgreSQL lock wait matching ${relationPattern} within ${timeoutMs}ms`,
      );
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * The fields Prisma actually attaches to a failed query, printed verbatim. The
 * reported code has to be the observed one, never an assumption about which
 * error Prisma uses for a deadlock or for an expired interactive transaction.
 */
function describeDatabaseError(error: unknown): string {
  if (!(error instanceof Error)) return `non-Error: ${String(error)}`;
  const record = error as Error & {
    code?: unknown;
    meta?: unknown;
    clientVersion?: unknown;
  };
  return [
    `name=${error.constructor.name}`,
    `code=${String(record.code)}`,
    `meta=${JSON.stringify(record.meta)}`,
    `clientVersion=${String(record.clientVersion)}`,
    `message=${error.message}`,
  ].join(' | ');
}

/** Narrow an unknown rejection to an Error so it can be rethrown as itself. */
function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/** Every field a PostgreSQL deadlock can reach the caller through. */
function deadlockEvidence(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const record = error as Error & { code?: unknown; meta?: unknown };
  return [String(record.code), JSON.stringify(record.meta), error.message]
    .map((part) => String(part))
    .join(' ');
}

/**
 * Test-owned completion facts: one cash outflow that exactly covers the total, an
 * enabled expense choice and a completion date, so the planner classifies
 * completion and the writer writes the expense. Used only where this suite
 * deliberately drives the production seam directly (scenarios 7 and 8).
 */
function completionFacts(
  total: string,
  date: string,
  outflowId: string,
): PayrollObligationCompletionFacts {
  return {
    total,
    outflows: [
      { id: outflowId, amount: total, date, method: PaymentMethod.CASH },
    ],
    expenseChoice: true,
    completionDate: date,
    selectedExpenseDate: null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describePostgres(
  'Payroll completion — PostgreSQL concurrency, rollback, expense guard and cash flow',
  () => {
    const runId = `payroll-pg-int-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    // One client per logical connection, so two (and three) transactions can be
    // in flight at the same time on genuinely different backends.
    let prisma: PrismaService;
    let prismaSecond: PrismaService;
    let prismaProbe: PrismaService;

    let orgId: string | undefined;
    let userId: string | undefined;
    let actor: RequestUser;

    let employeePeriodId: string;
    let employeeGroupId: string;
    let employeeCashFlowId: string;
    let employeeDeadlockId: string;
    let employeeIntruderId: string;
    let employeeTimeoutId: string;
    let employeeTaxonomyId: string;
    let employeeCrossTenantId: string;

    let labelId: string;
    let controlLabelId: string;
    let expenseGroupId: string;
    let labelBId: string;
    let expenseGroupBId: string;

    let concurrentObligationId: string;
    let rollbackObligationId: string;
    let cashFlowObligationId: string;
    let deadlockObligationAId: string;
    let deadlockObligationBId: string;
    let intruderObligationId: string;
    let timeoutObligationId: string;
    let taxonomyBeforeWriteObligationId: string;
    let taxonomyAfterWriteObligationId: string;
    let taxonomyGroupObligationId: string;
    let crossTenantObligationAId: string;

    let concurrentExpenseId: string;
    let concurrentOutflowId: string;

    // Second namespaced tenant of scenario 8. It owns its own user, category,
    // employee, obligations, cash and expense, so any leak between the two is
    // visible as a changed row instead of a shared fixture.
    let orgBId: string | undefined;
    let userBId: string | undefined;
    let actorB: RequestUser;
    let employeeTenantBId: string;
    let tenantBPendingObligationId: string;
    let tenantBPendingOutflowId: string;
    let tenantBPendingInstallmentId: string;
    let tenantBCompletedObligationId: string;
    let tenantBCompletedOutflowId: string;
    let tenantBCompletedInstallmentId: string;
    let tenantBExpenseId: string;

    // Scenarios 9-13: the grouped correction writer and the reference-based
    // replacement writer. Each scenario owns its employees and shifts.
    let employeeCorrectionConcurrentId: string;
    let employeeCorrectionRollbackId: string;
    let employeeCorrectionTimeoutId: string;
    let employeeReplacementRaceId: string;
    let employeeReplacementCompleteId: string;
    let employeeOrganizationProbeAId: string;
    let employeeOrganizationProbeBId: string;

    let correctionConcurrentObligationId: string;
    let correctionConcurrentInstallmentId: string;
    let correctionConcurrentOutflowId: string;
    let correctionRollbackObligationId: string;
    let correctionRollbackInstallmentId: string;
    let correctionTimeoutObligationId: string;
    let correctionTimeoutInstallmentId: string;
    let correctionTimeoutAllocationId: string;
    let replacementRaceSourceObligationId: string;
    let replacementRaceInstallmentId: string;
    let replacementCompleteSourceObligationId: string;
    let replacementCompleteExpenseInstallmentId: string;
    let replacementCompleteNoExpenseInstallmentId: string;
    let organizationProbeObligationAId: string;
    let organizationProbeObligationBId: string;

    let periodInstallments: PayrollPeriodInstallmentsService;
    let periodInstallmentsSecond: PayrollPeriodInstallmentsService;
    let groupInstallments: PayrollGroupInstallmentsService;
    let correction: PayrollPeriodInstallmentCorrectionService;
    let groupCorrection: PayrollGroupInstallmentCorrectionService;
    let groupCorrectionSecond: PayrollGroupInstallmentCorrectionService;
    let replacement: PayrollReplacementPaymentService;
    let replacementSecond: PayrollReplacementPaymentService;
    let obligations: PayrollObligationsService;
    let expenses: ExpensesService;
    let reports: ReportsService;

    /** Row counts of every table this suite writes to, before its fixtures. */
    let baselineCounts: Record<string, number> = {};

    async function tableCounts(
      client: PrismaService,
    ): Promise<Record<string, number>> {
      const [
        organizations,
        users,
        employees,
        shifts,
        obligations,
        memberships,
        outflows,
        installments,
        allocations,
        allocationVoids,
        revisions,
        references,
        links,
        expenses,
        expensePayments,
        labels,
        groups,
        audits,
      ] = await Promise.all([
        client.organization.count(),
        client.user.count(),
        client.employee.count(),
        client.employeeShift.count(),
        client.payrollObligation.count(),
        client.payrollShiftMembership.count(),
        client.payrollCashOutflow.count(),
        client.payrollInstallment.count(),
        client.payrollAllocation.count(),
        client.payrollAllocationVoid.count(),
        client.payrollCashRevision.count(),
        client.payrollInstallmentReference.count(),
        client.payrollObligationExpense.count(),
        client.expense.count(),
        client.expensePayment.count(),
        client.expenseLabel.count(),
        client.expenseGroup.count(),
        client.auditLog.count(),
      ]);
      return {
        organization: organizations,
        user: users,
        employee: employees,
        employeeShift: shifts,
        payrollObligation: obligations,
        payrollShiftMembership: memberships,
        payrollCashOutflow: outflows,
        payrollInstallment: installments,
        payrollAllocation: allocations,
        payrollAllocationVoid: allocationVoids,
        payrollCashRevision: revisions,
        payrollInstallmentReference: references,
        payrollObligationExpense: links,
        expense: expenses,
        expensePayment: expensePayments,
        expenseLabel: labels,
        expenseGroup: groups,
        auditLog: audits,
      };
    }

    beforeAll(async () => {
      prisma = new PrismaService();
      prismaSecond = new PrismaService();
      prismaProbe = new PrismaService();

      await assertLocalDevelopmentDatabase(prisma);
      baselineCounts = await tableCounts(prisma);

      const organization = await prisma.organization.create({
        data: {
          name: `Payroll PG integration ${runId}`,
          slug: runId,
          plan: PlanType.BASIC,
          active: true,
        },
      });
      orgId = organization.id;

      const user = await prisma.user.create({
        data: {
          email: `${runId}@example.invalid`,
          password: 'not-a-real-hash',
          name: 'Payroll PG integration owner',
        },
      });
      userId = user.id;

      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrgRole.OWNER,
          isPrimaryOwner: true,
        },
      });

      actor = {
        userId: user.id,
        email: user.email,
        organizationId: organization.id,
        role: OrgRole.OWNER,
        tokenVersion: 0,
        isSuperAdmin: false,
      };

      // The fixed payroll expense category of S5, created explicitly so the
      // concurrency scenario exercises obligation locking and not the taxonomy
      // creation path. A second label is the non-payroll control of scenario 4.
      const expenseGroup = await prisma.expenseGroup.create({
        data: { organizationId: organization.id, name: 'Nómina' },
      });
      const payrollLabel = await prisma.expenseLabel.create({
        data: {
          organizationId: organization.id,
          groupId: expenseGroup.id,
          name: 'Nómina',
        },
      });
      expenseGroupId = expenseGroup.id;
      labelId = payrollLabel.id;
      const controlLabel = await prisma.expenseLabel.create({
        data: {
          organizationId: organization.id,
          groupId: expenseGroup.id,
          name: 'General',
        },
      });
      controlLabelId = controlLabel.id;
      await prisma.payrollExpenseCategory.create({
        data: {
          organizationId: organization.id,
          groupId: expenseGroup.id,
          labelId: payrollLabel.id,
        },
      });

      const employees = await Promise.all(
        ['period', 'group', 'cash-flow'].map((suffix) =>
          prisma.employee.create({
            data: {
              organizationId: organization.id,
              name: `Payroll PG ${runId} ${suffix}`,
              identification: `${runId}-${suffix}`,
              active: true,
            },
          }),
        ),
      );
      employeePeriodId = employees[0].id;
      employeeGroupId = employees[1].id;
      employeeCashFlowId = employees[2].id;

      // Grouped shifts for the rollback scenario (S3 storage: one shift per day,
      // positive amount). They are the only allocation targets this suite uses.
      const rollbackShifts = await Promise.all(
        ['2026-05-01', '2026-05-02'].map((date) =>
          prisma.employeeShift.create({
            data: {
              organizationId: organization.id,
              employeeId: employeeGroupId,
              date: new Date(`${date}T00:00:00.000Z`),
              kind: EmployeeShiftKind.FULL_DAY,
              amount: new Prisma.Decimal('150.00'),
            },
          }),
        ),
      );

      const periods = new PayrollPeriodsService(prisma);
      const groups = new PayrollGroupsService(prisma);

      const concurrentObligation = await periods.create(
        {
          employeeId: employeePeriodId,
          periodStart: '2026-04-01',
          periodEnd: '2026-04-30',
          periodAmount: PERIOD_TOTAL,
          expenseEnabled: true,
        },
        organization.id,
        actor,
      );
      concurrentObligationId = concurrentObligation.id;

      const rollbackObligation = await groups.create(
        {
          employeeId: employeeGroupId,
          shiftIds: rollbackShifts.map((shift) => shift.id),
          expenseEnabled: true,
        },
        organization.id,
        actor,
      );
      rollbackObligationId = rollbackObligation.id;

      const cashFlowObligation = await periods.create(
        {
          employeeId: employeeCashFlowId,
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          periodAmount: CASH_FLOW_TOTAL,
          expenseEnabled: true,
        },
        organization.id,
        actor,
      );
      cashFlowObligationId = cashFlowObligation.id;

      periodInstallments = new PayrollPeriodInstallmentsService(prisma);
      periodInstallmentsSecond = new PayrollPeriodInstallmentsService(
        prismaSecond,
      );
      groupInstallments = new PayrollGroupInstallmentsService(prisma);
      correction = new PayrollPeriodInstallmentCorrectionService(prisma);
      groupCorrection = new PayrollGroupInstallmentCorrectionService(prisma);
      groupCorrectionSecond = new PayrollGroupInstallmentCorrectionService(
        prismaSecond,
      );
      replacement = new PayrollReplacementPaymentService(prisma);
      replacementSecond = new PayrollReplacementPaymentService(prismaSecond);
      obligations = new PayrollObligationsService(prisma);
      expenses = new ExpensesService(prisma, {} as never);
      reports = new ReportsService(prisma, new CacheService());

      // ---------------------------------------------------------------------
      // Scenarios 5-8. Every scenario owns its employees, so its payroll row set
      // is disjoint from the scenarios above and their assertions stay valid.
      // ---------------------------------------------------------------------
      const scenarioEmployees = await Promise.all(
        ['deadlock', 'intruder', 'timeout', 'taxonomy', 'isolation'].map(
          (suffix) =>
            prisma.employee.create({
              data: {
                organizationId: organization.id,
                name: `Payroll PG ${runId} ${suffix}`,
                identification: `${runId}-${suffix}`,
                active: true,
              },
            }),
        ),
      );
      employeeDeadlockId = scenarioEmployees[0].id;
      employeeIntruderId = scenarioEmployees[1].id;
      employeeTimeoutId = scenarioEmployees[2].id;
      employeeTaxonomyId = scenarioEmployees[3].id;
      employeeCrossTenantId = scenarioEmployees[4].id;

      // Same period window on purpose: the payroll period path stores no
      // uniqueness over it, and each payment belongs to its own employee.
      const createPeriod = (
        employeeId: string,
        periodAmount: string,
        expenseEnabled: boolean,
      ) =>
        periods.create(
          {
            employeeId,
            periodStart: '2026-08-01',
            periodEnd: '2026-08-31',
            periodAmount,
            expenseEnabled,
          },
          organization.id,
          actor,
        );

      deadlockObligationAId = (
        await createPeriod(employeeDeadlockId, DEADLOCK_TOTAL_A, true)
      ).id;
      deadlockObligationBId = (
        await createPeriod(employeeDeadlockId, DEADLOCK_TOTAL_B, true)
      ).id;
      intruderObligationId = (
        await createPeriod(employeeIntruderId, INTRUDER_TOTAL, true)
      ).id;
      timeoutObligationId = (
        await createPeriod(employeeTimeoutId, TIMEOUT_TOTAL, true)
      ).id;
      taxonomyBeforeWriteObligationId = (
        await createPeriod(
          employeeTaxonomyId,
          TAXONOMY_TOTAL_BEFORE_WRITE,
          true,
        )
      ).id;
      taxonomyAfterWriteObligationId = (
        await createPeriod(employeeTaxonomyId, TAXONOMY_TOTAL_AFTER_WRITE, true)
      ).id;
      taxonomyGroupObligationId = (
        await createPeriod(
          employeeTaxonomyId,
          TAXONOMY_TOTAL_AFTER_GROUP_WRITE,
          true,
        )
      ).id;
      crossTenantObligationAId = (
        await createPeriod(employeeCrossTenantId, ISOLATION_TOTAL_A, false)
      ).id;

      // The second tenant: its own user, its own payroll category, its own
      // obligation with real partial cash and its own completed payment with a
      // real linked expense.
      const organizationB = await prisma.organization.create({
        data: {
          name: `Payroll PG isolation ${runId}`,
          slug: `${runId}-b`,
          plan: PlanType.BASIC,
          active: true,
        },
      });
      orgBId = organizationB.id;
      const userB = await prisma.user.create({
        data: {
          email: `${runId}-b@example.invalid`,
          password: 'not-a-real-hash',
          name: 'Payroll PG isolation owner',
        },
      });
      userBId = userB.id;
      await prisma.organizationUser.create({
        data: {
          userId: userB.id,
          organizationId: organizationB.id,
          role: OrgRole.OWNER,
          isPrimaryOwner: true,
        },
      });
      actorB = {
        userId: userB.id,
        email: userB.email,
        organizationId: organizationB.id,
        role: OrgRole.OWNER,
        tokenVersion: 0,
        isSuperAdmin: false,
      };

      const expenseGroupB = await prisma.expenseGroup.create({
        data: { organizationId: organizationB.id, name: 'Nómina' },
      });
      expenseGroupBId = expenseGroupB.id;
      const labelB = await prisma.expenseLabel.create({
        data: {
          organizationId: organizationB.id,
          groupId: expenseGroupB.id,
          name: 'Nómina',
        },
      });
      labelBId = labelB.id;
      await prisma.payrollExpenseCategory.create({
        data: {
          organizationId: organizationB.id,
          groupId: expenseGroupB.id,
          labelId: labelB.id,
        },
      });
      const employeeB = await prisma.employee.create({
        data: {
          organizationId: organizationB.id,
          name: `Payroll PG ${runId} isolation B`,
          identification: `${runId}-isolation-b`,
          active: true,
        },
      });
      employeeTenantBId = employeeB.id;

      const periodBPending = await periods.create(
        {
          employeeId: employeeB.id,
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          periodAmount: ISOLATION_TOTAL_B_PENDING,
          expenseEnabled: true,
        },
        organizationB.id,
        actorB,
      );
      tenantBPendingObligationId = periodBPending.id;
      const partialB = await periodInstallments.create(
        {
          employeeId: employeeB.id,
          obligationId: periodBPending.id,
          amount: ISOLATION_PAID_B,
          date: DATE_ISOLATION,
          method: PaymentMethod.CASH,
        },
        organizationB.id,
        actorB,
      );
      tenantBPendingOutflowId = partialB.outflow.id;
      tenantBPendingInstallmentId = partialB.installment.id;

      const periodBCompleted = await periods.create(
        {
          employeeId: employeeB.id,
          periodStart: '2026-11-01',
          periodEnd: '2026-11-30',
          periodAmount: ISOLATION_TOTAL_B_COMPLETED,
          expenseEnabled: true,
        },
        organizationB.id,
        actorB,
      );
      tenantBCompletedObligationId = periodBCompleted.id;
      const completionB = await periodInstallments.create(
        {
          employeeId: employeeB.id,
          obligationId: periodBCompleted.id,
          amount: ISOLATION_TOTAL_B_COMPLETED,
          date: DATE_ISOLATION,
          method: PaymentMethod.CASH,
        },
        organizationB.id,
        actorB,
      );
      tenantBCompletedOutflowId = completionB.outflow.id;
      tenantBCompletedInstallmentId = completionB.installment.id;
      const linkB = await prisma.payrollObligationExpense.findFirstOrThrow({
        where: {
          organizationId: organizationB.id,
          obligationId: periodBCompleted.id,
        },
      });
      tenantBExpenseId = linkB.expenseId;

      console.log(
        `[payroll-pg-int] fixtures created: org=${organization.id} slug=${runId} employees=3 obligations=3 shifts=2`,
      );
      console.log(
        `[payroll-pg-int] scenario 5-8 fixtures: org=${organization.id} employees=5 obligations=7 tenantB=${organizationB.id} tenantB_obligations=2 tenantB_outflows=2 tenantB_expenses=1`,
      );

      // ---------------------------------------------------------------------
      // Scenarios 9-13: grouped correction and reference-based replacement.
      // ---------------------------------------------------------------------
      const writerEmployees = await Promise.all(
        [
          'correction-concurrent',
          'correction-rollback',
          'correction-timeout',
          'replacement-race',
          'replacement-complete',
          'organization-probe-a',
          'organization-probe-b',
        ].map((suffix) =>
          prisma.employee.create({
            data: {
              organizationId: organization.id,
              name: `Payroll PG ${runId} ${suffix}`,
              identification: `${runId}-${suffix}`,
              active: true,
            },
          }),
        ),
      );
      employeeCorrectionConcurrentId = writerEmployees[0].id;
      employeeCorrectionRollbackId = writerEmployees[1].id;
      employeeCorrectionTimeoutId = writerEmployees[2].id;
      employeeReplacementRaceId = writerEmployees[3].id;
      employeeReplacementCompleteId = writerEmployees[4].id;
      employeeOrganizationProbeAId = writerEmployees[5].id;
      employeeOrganizationProbeBId = writerEmployees[6].id;

      // Two dated shifts of 110.00 each, owned by one grouped payment: the
      // positive amounts and one-shift-per-day rules of S2/S3 hold by construction.
      const createGroupPayment = async (
        employeeId: string,
        shiftDates: [string, string],
        expenseEnabled: boolean,
      ): Promise<string> => {
        const shifts = await Promise.all(
          shiftDates.map((date) =>
            prisma.employeeShift.create({
              data: {
                organizationId: organization.id,
                employeeId,
                date: new Date(`${date}T00:00:00.000Z`),
                kind: EmployeeShiftKind.FULL_DAY,
                amount: new Prisma.Decimal(GROUPED_SHIFT_AMOUNT),
              },
            }),
          ),
        );
        const obligation = await groups.create(
          {
            employeeId,
            shiftIds: shifts.map((shift) => shift.id),
            expenseEnabled,
          },
          organization.id,
          actor,
        );
        return obligation.id;
      };

      const payGroup = (
        employeeId: string,
        obligationId: string,
        amount: string,
        date: string,
      ) =>
        groupInstallments.create(
          {
            employeeId,
            obligationId,
            amount,
            date,
            method: PaymentMethod.CASH,
          },
          organization.id,
          actor,
        );

      // Scenario 9: one pending grouped payment of 75.00 on a 220.00 group; both
      // concurrent corrections try to complete it, so only one can survive.
      correctionConcurrentObligationId = await createGroupPayment(
        employeeCorrectionConcurrentId,
        ['2026-11-01', '2026-11-02'],
        false,
      );
      const concurrentFirstInstallment = await payGroup(
        employeeCorrectionConcurrentId,
        correctionConcurrentObligationId,
        CORRECTION_FIRST_TOTAL,
        DATE_CORRECTION_CONCURRENT,
      );
      correctionConcurrentInstallmentId =
        concurrentFirstInstallment.installment.id;
      correctionConcurrentOutflowId = concurrentFirstInstallment.outflow.id;

      // Scenario 10: the same shape with the stored expense choice enabled, so the
      // completing correction reaches the in-transaction expense writer.
      correctionRollbackObligationId = await createGroupPayment(
        employeeCorrectionRollbackId,
        ['2026-12-01', '2026-12-02'],
        true,
      );
      correctionRollbackInstallmentId = (
        await payGroup(
          employeeCorrectionRollbackId,
          correctionRollbackObligationId,
          CORRECTION_FIRST_TOTAL,
          DATE_CORRECTION_ROLLBACK,
        )
      ).installment.id;

      correctionTimeoutObligationId = await createGroupPayment(
        employeeCorrectionTimeoutId,
        ['2027-01-01', '2027-01-02'],
        true,
      );
      correctionTimeoutInstallmentId = (
        await payGroup(
          employeeCorrectionTimeoutId,
          correctionTimeoutObligationId,
          CORRECTION_FIRST_TOTAL,
          DATE_CORRECTION_TIMEOUT,
        )
      ).installment.id;
      // The application the correction must supersede: scenario 10 blocks on it
      // after the expense of the same transaction was already written.
      correctionTimeoutAllocationId = (
        await prisma.payrollAllocation.findFirstOrThrow({
          where: { installmentId: correctionTimeoutInstallmentId },
          select: { id: true },
        })
      ).id;

      // Scenario 11: a completed grouped payment of 220.00 in two installments, so
      // one of them can be referenced and a balance still remains.
      replacementRaceSourceObligationId = await createGroupPayment(
        employeeReplacementRaceId,
        ['2027-02-01', '2027-02-02'],
        false,
      );
      replacementRaceInstallmentId = (
        await payGroup(
          employeeReplacementRaceId,
          replacementRaceSourceObligationId,
          REPLACEMENT_FIRST_TOTAL,
          DATE_REPLACEMENT_RACE,
        )
      ).installment.id;
      await payGroup(
        employeeReplacementRaceId,
        replacementRaceSourceObligationId,
        REPLACEMENT_SECOND_TOTAL,
        DATE_REPLACEMENT_RACE_LATER,
      );

      // Scenario 12: the same completed shape, with both installments kept for two
      // replacements that carry opposite expense choices.
      replacementCompleteSourceObligationId = await createGroupPayment(
        employeeReplacementCompleteId,
        ['2027-03-01', '2027-03-02'],
        false,
      );
      replacementCompleteExpenseInstallmentId = (
        await payGroup(
          employeeReplacementCompleteId,
          replacementCompleteSourceObligationId,
          REPLACEMENT_FIRST_TOTAL,
          DATE_REPLACEMENT_SOURCE,
        )
      ).installment.id;
      replacementCompleteNoExpenseInstallmentId = (
        await payGroup(
          employeeReplacementCompleteId,
          replacementCompleteSourceObligationId,
          REPLACEMENT_SECOND_TOTAL,
          DATE_REPLACEMENT_SOURCE_LATER,
        )
      ).installment.id;

      // Scenario 13: two pending fixed-period payments of different employees of
      // the same tenant, both with an enabled expense choice.
      organizationProbeObligationAId = (
        await periods.create(
          {
            employeeId: employeeOrganizationProbeAId,
            periodStart: '2027-04-01',
            periodEnd: '2027-04-30',
            periodAmount: ORGANIZATION_PROBE_TOTAL_A,
            expenseEnabled: true,
          },
          organization.id,
          actor,
        )
      ).id;
      organizationProbeObligationBId = (
        await periods.create(
          {
            employeeId: employeeOrganizationProbeBId,
            periodStart: '2027-04-01',
            periodEnd: '2027-04-30',
            periodAmount: ORGANIZATION_PROBE_TOTAL_B,
            expenseEnabled: true,
          },
          organization.id,
          actor,
        )
      ).id;

      const writerSourceStatuses = await prisma.payrollObligation.findMany({
        where: {
          id: {
            in: [
              replacementRaceSourceObligationId,
              replacementCompleteSourceObligationId,
            ],
          },
        },
        select: { id: true, status: true },
      });
      if (writerSourceStatuses.some((row) => row.status !== 'COMPLETED'))
        throw new Error(
          'Scenario 11/12 source payments were not completed by their installments',
        );
      console.log(
        `[payroll-pg-int] scenario 9-13 fixtures: org=${organization.id} employees=7 group_obligations=5 period_obligations=2 grouped_installments=7 references=0`,
      );
    }, 60000);

    afterAll(async () => {
      const createdUserIds = [userId, userBId].filter(
        (value): value is string => typeof value === 'string',
      );
      const createdOrgIds = [orgId, orgBId].filter(
        (value): value is string => typeof value === 'string',
      );
      let afterCounts: Record<string, number> | undefined;
      let cleanupError: Error | undefined;

      try {
        if (createdOrgIds.length > 0) {
          await prisma.$transaction(
            async (tx) => {
              // The payroll history tables reject ordinary UPDATE and DELETE with
              // BEFORE triggers. Replica mode disables user and foreign-key
              // constraint triggers for this transaction. Every deletion must
              // therefore stay scoped to the newly created fixture organizations.
              // The preflight check guarantees the role may do this.
              await tx.$executeRawUnsafe(
                'SET LOCAL session_replication_role = replica',
              );
              for (const createdOrgId of createdOrgIds) {
                // Children first, then parents.
                await tx.payrollAllocationVoid.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.payrollAllocation.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.payrollCashRevision.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.payrollInstallmentReference.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.payrollObligationExpense.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.payrollInstallment.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.payrollCashOutflow.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.payrollShiftMembership.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.payrollObligation.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.employeeShift.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.employee.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.expensePayment.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.expense.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.payrollExpenseCategory.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.expenseLabel.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.expenseGroup.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.auditLog.deleteMany({
                  where: { organizationId: createdOrgId },
                });
                await tx.organizationUser.deleteMany({
                  where: { organizationId: createdOrgId },
                });
              }
            },
            { timeout: 30000, maxWait: 30000 },
          );

          // Outside replica mode: the users and the tenants go through their normal
          // constraints, so a missed child row fails loudly instead of being hidden.
          if (createdUserIds.length > 0)
            await prisma.user.deleteMany({
              where: { id: { in: createdUserIds } },
            });
          for (const createdOrgId of createdOrgIds)
            await prisma.organization.deleteMany({
              where: { id: createdOrgId },
            });

          const leftovers: string[] = [];
          for (const createdOrgId of createdOrgIds) {
            const remaining = await prisma.payrollCashOutflow.count({
              where: { organizationId: createdOrgId },
            });
            const remainingLinks = await prisma.payrollObligationExpense.count({
              where: { organizationId: createdOrgId },
            });
            const remainingReferences =
              await prisma.payrollInstallmentReference.count({
                where: { organizationId: createdOrgId },
              });
            const remainingExpenses = await prisma.expense.count({
              where: { organizationId: createdOrgId },
            });
            const remainingOrg = await prisma.organization.count({
              where: { id: createdOrgId },
            });
            if (
              remaining !== 0 ||
              remainingLinks !== 0 ||
              remainingReferences !== 0 ||
              remainingExpenses !== 0 ||
              remainingOrg !== 0
            )
              leftovers.push(
                `org=${createdOrgId} outflows=${remaining} links=${remainingLinks} references=${remainingReferences} expenses=${remainingExpenses} organizations=${remainingOrg}`,
              );
          }
          if (leftovers.length > 0)
            throw new Error(
              `Fixture cleanup left rows behind: ${leftovers.join('; ')}`,
            );

          afterCounts = await tableCounts(prisma);
          const shrank = Object.keys(baselineCounts).filter(
            (table) => afterCounts![table] < baselineCounts[table],
          );
          if (shrank.length > 0)
            throw new Error(
              `Cleanup removed pre-existing rows from: ${shrank.join(', ')}`,
            );

          console.log(
            `[payroll-pg-int] fixtures removed for ${createdOrgIds.length} organizations: outflows=0 links=0 references=0 expenses=0 organizations=0`,
          );
          console.log(
            `[payroll-pg-int] pre-existing rows preserved (before -> after): ${Object.keys(
              baselineCounts,
            )
              .map(
                (table) =>
                  `${table}=${baselineCounts[table]}->${afterCounts![table]}`,
              )
              .join(' ')}`,
          );
        }
      } catch (error) {
        cleanupError =
          error instanceof Error
            ? error
            : new Error('Fixture cleanup failed with a non-Error value');
      } finally {
        await Promise.all([
          prisma?.$disconnect(),
          prismaSecond?.$disconnect(),
          prismaProbe?.$disconnect(),
        ]);
      }

      if (cleanupError) throw cleanupError;
    }, 60000);

    it('1. two concurrent completing installments: exactly one succeeds, one outflow, one expense, one link', async () => {
      const request = {
        employeeId: employeePeriodId,
        obligationId: concurrentObligationId,
        amount: PERIOD_TOTAL,
        date: DATE_CONCURRENT,
        method: PaymentMethod.CASH,
      };

      // Two services on two different clients: two real PostgreSQL backends, each
      // opening its own transaction. Both requests would complete the payment.
      const results = await Promise.allSettled([
        periodInstallments.create({ ...request }, orgId, actor),
        periodInstallmentsSecond.create({ ...request }, orgId, actor),
      ]);

      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // A loss must be the payroll conflict, never a lock-wait/timeout artifact.
      const failure = rejected[0].reason as Error;
      expect(failure).toBeInstanceOf(ConflictException);
      expect([
        'Pago no disponible',
        'Pago modificado',
        'Abono excede el saldo disponible',
      ]).toContain(failure.message);
      console.log(
        `[payroll-pg-int] concurrent completion loser: ${failure.constructor.name}: ${failure.message}`,
      );

      const obligation = await prisma.payrollObligation.findUniqueOrThrow({
        where: { id: concurrentObligationId },
      });
      expect(obligation.status).toBe('COMPLETED');
      expect(obligation.version).toBe(1);

      const outflows = await prisma.payrollCashOutflow.findMany({
        where: { organizationId: orgId, employeeId: employeePeriodId },
      });
      expect(outflows).toHaveLength(1);
      expect(outflows[0].amount.toFixed(2)).toBe(PERIOD_TOTAL);
      expect(outflows[0].method).toBe(PaymentMethod.CASH);
      concurrentOutflowId = outflows[0].id;

      const installments = await prisma.payrollInstallment.findMany({
        where: { organizationId: orgId, obligationId: concurrentObligationId },
      });
      expect(installments).toHaveLength(1);
      expect(installments[0].outflowId).toBe(concurrentOutflowId);

      // Exactly one expense and exactly one link: the loser wrote neither.
      const orgExpenses = await prisma.expense.findMany({
        where: { organizationId: orgId },
        include: { payments: true },
      });
      expect(orgExpenses).toHaveLength(1);
      expect(orgExpenses[0].total.toFixed(2)).toBe(PERIOD_TOTAL);
      expect(orgExpenses[0].payments).toHaveLength(1);
      expect(orgExpenses[0].payments[0].amount.toFixed(2)).toBe(PERIOD_TOTAL);
      expect(orgExpenses[0].payments[0].method).toBe(PaymentMethod.CASH);
      concurrentExpenseId = orgExpenses[0].id;

      const links = await prisma.payrollObligationExpense.findMany({
        where: { organizationId: orgId },
      });
      expect(links).toHaveLength(1);
      expect(links[0].obligationId).toBe(concurrentObligationId);
      expect(links[0].expenseId).toBe(concurrentExpenseId);

      // One audit row for the expense that was actually written.
      const auditRows = await prisma.auditLog.findMany({
        where: { organizationId: orgId, resource: 'Expense' },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('EXPENSE_CREATED');
      expect(auditRows[0].resourceId).toBe(concurrentExpenseId);
    }, 60000);

    it('2. a failing expense write rolls back cash outflow, installment, allocations and obligation status', async () => {
      // The approved fail-closed path: an inactive payroll category makes the
      // in-transaction expense write throw *after* the cash, installment and
      // allocation inserts of the same transaction.
      await prisma.expenseLabel.update({
        where: { id: labelId },
        data: { active: false },
      });

      const request = {
        employeeId: employeeGroupId,
        obligationId: rollbackObligationId,
        amount: GROUP_TOTAL,
        date: DATE_ROLLBACK,
        method: PaymentMethod.CASH,
      };
      const auditsBefore = await prisma.auditLog.count({
        where: { organizationId: orgId },
      });
      const expensesBefore = await prisma.expense.count({
        where: { organizationId: orgId },
      });

      const failure = await (async () => {
        try {
          await groupInstallments.create({ ...request }, orgId, actor);
          return null;
        } catch (error) {
          return error instanceof Error
            ? error
            : new Error('non-Error failure');
        } finally {
          // Always restore the category, so a failure in this scenario cannot
          // cascade into the expense-dependent scenarios that follow.
          await prisma.expenseLabel.update({
            where: { id: labelId },
            data: { active: true },
          });
        }
      })();
      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as Error).message).toContain(
        'La categoría de gasto de nómina está inactiva',
      );

      // Nothing of the failed completion survives.
      const pending = await prisma.payrollObligation.findUniqueOrThrow({
        where: { id: rollbackObligationId },
      });
      expect(pending.status).toBe('PENDING');
      expect(pending.version).toBe(0);
      await expect(
        prisma.payrollCashOutflow.count({
          where: { organizationId: orgId, employeeId: employeeGroupId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollInstallment.count({
          where: { organizationId: orgId, obligationId: rollbackObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollAllocation.count({
          where: { organizationId: orgId, obligationId: rollbackObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollObligationExpense.count({
          where: { organizationId: orgId, obligationId: rollbackObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBefore);
      await expect(
        prisma.auditLog.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(auditsBefore);

      // Control: the same request succeeds now that the expense write can succeed,
      // so the rollback above was caused by the expense failure and nothing was
      // half-written in a way that blocks the retry.
      const retried = await groupInstallments.create(
        { ...request },
        orgId,
        actor,
      );
      expect(retried.status).toBe('COMPLETED');

      const completed = await prisma.payrollObligation.findUniqueOrThrow({
        where: { id: rollbackObligationId },
      });
      expect(completed.status).toBe('COMPLETED');
      expect(completed.version).toBe(1);

      const outflows = await prisma.payrollCashOutflow.findMany({
        where: { organizationId: orgId, employeeId: employeeGroupId },
      });
      expect(outflows).toHaveLength(1);
      expect(outflows[0].amount.toFixed(2)).toBe(GROUP_TOTAL);

      const installments = await prisma.payrollInstallment.findMany({
        where: { organizationId: orgId, obligationId: rollbackObligationId },
      });
      expect(installments).toHaveLength(1);

      const allocations = await prisma.payrollAllocation.findMany({
        where: { organizationId: orgId, obligationId: rollbackObligationId },
      });
      expect(allocations).toHaveLength(2);
      expect(
        allocations.map((allocation) => allocation.amount.toFixed(2)).sort(),
      ).toEqual(['150.00', '150.00']);

      const links = await prisma.payrollObligationExpense.findMany({
        where: { organizationId: orgId, obligationId: rollbackObligationId },
      });
      expect(links).toHaveLength(1);
      const linkedExpense = await prisma.expense.findUniqueOrThrow({
        where: { id: links[0].expenseId },
        include: { payments: true },
      });
      expect(linkedExpense.total.toFixed(2)).toBe(GROUP_TOTAL);
      expect(linkedExpense.payments).toHaveLength(1);
    }, 60000);

    it('3. the expense guard waits for the completion lock, then refuses the edit, and never allows it afterwards', async () => {
      // The real writer, in its own open transaction, performing its real replay
      // verification: it takes the shared `Expense ... FOR UPDATE` row lock and
      // reports `already_linked`. The transaction then stays open (as a completion
      // would until it commits), so the guard must contend with that exact lock.
      let releaseLock = (): void => {};
      const holdLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      let writerOutcome: unknown;
      const completion = prisma.$transaction(
        async (tx) => {
          writerOutcome = await writePayrollCompletionExpense(tx, {
            organizationId: orgId as string,
            employeeId: employeePeriodId,
            obligationId: concurrentObligationId,
            actor,
            facts: {
              total: PERIOD_TOTAL,
              outflows: [
                {
                  id: concurrentOutflowId,
                  amount: PERIOD_TOTAL,
                  date: DATE_CONCURRENT,
                  method: PaymentMethod.CASH,
                },
              ],
              expenseChoice: true,
              completionDate: DATE_CONCURRENT,
              selectedExpenseDate: null,
            },
          });
          await holdLock;
          return writerOutcome;
        },
        { timeout: 30000, maxWait: 30000 },
      );

      const guardAttempt = expenses.update(
        concurrentExpenseId,
        { description: 'mutado por la API de gastos' },
        userId as string,
        orgId,
      );
      const guardSettled = guardAttempt.then(
        () => 'settled' as const,
        () => 'settled' as const,
      );

      try {
        // PostgreSQL itself reports the guard's backend waiting on the row lock.
        const waiters = await waitForExpenseLockWaiter(prismaProbe, 10000);
        expect(waiters).toBeGreaterThan(0);
        expect(
          await Promise.race([
            guardSettled,
            delay(200).then(() => 'pending' as const),
          ]),
        ).toBe('pending');
      } finally {
        releaseLock();
      }

      await expect(completion).resolves.toEqual({
        kind: 'already_linked',
        expenseId: concurrentExpenseId,
      });
      expect(writerOutcome).toEqual({
        kind: 'already_linked',
        expenseId: concurrentExpenseId,
      });

      // Same lock, different statement: once released, the guard decides from the
      // committed link and refuses the edit with 409.
      await expect(guardAttempt).rejects.toBeInstanceOf(ConflictException);
      await expect(
        expenses.update(
          concurrentExpenseId,
          { description: 'mutado por la API de gastos' },
          userId as string,
          orgId,
        ),
      ).rejects.toThrow(
        'La salida está vinculada a una obligación de nómina y no puede modificarse',
      );

      const before = await prisma.expense.findUniqueOrThrow({
        where: { id: concurrentExpenseId },
        include: { payments: true },
      });

      // The guard is not a one-shot: every later mutation is refused too.
      await expect(
        expenses.remove(concurrentExpenseId, userId as string, orgId),
      ).rejects.toThrow(ConflictException);
      // A positive extra payment is already refused by the payments-sum rule
      // before the guard can be reached, so the reachable guard case is a zero
      // amount (the HTTP DTO rejects it first; here the guard is the refusal).
      await expect(
        expenses.addPayment(
          concurrentExpenseId,
          {
            amount: 20,
            method: PaymentMethod.CASH,
            date: DATE_CONCURRENT,
          },
          userId as string,
          orgId,
        ),
      ).rejects.toThrow(
        'La suma de los pagos no puede superar el total de la salida',
      );
      await expect(
        expenses.addPayment(
          concurrentExpenseId,
          { amount: 0, method: PaymentMethod.CASH, date: DATE_CONCURRENT },
          userId as string,
          orgId,
        ),
      ).rejects.toThrow(
        'La salida está vinculada a una obligación de nómina y no puede modificarse',
      );

      const after = await prisma.expense.findUniqueOrThrow({
        where: { id: concurrentExpenseId },
        include: { payments: true },
      });
      expect(after.total.toFixed(2)).toBe(before.total.toFixed(2));
      expect(after.date.getTime()).toBe(before.date.getTime());
      expect(after.description).toBe(before.description);
      expect(after.description).toBeNull();
      expect(after.active).toBe(true);
      expect(after.status).toBe(before.status);
      expect(after.payments).toHaveLength(1);
      expect(after.payments[0].amount.toFixed(2)).toBe(PERIOD_TOTAL);

      // No expense mutation was ever audited for this row.
      const auditRows = await prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          resource: 'Expense',
          resourceId: concurrentExpenseId,
        },
      });
      expect(auditRows.map((row) => row.action)).toEqual(['EXPENSE_CREATED']);
    }, 60000);

    it('4. cash flow counts the payroll outflow once and excludes its mirrored expense payment', async () => {
      const completion = await periodInstallments.create(
        {
          employeeId: employeeCashFlowId,
          obligationId: cashFlowObligationId,
          amount: CASH_FLOW_TOTAL,
          date: DATE_CASH_FLOW,
          method: PaymentMethod.CASH,
        },
        orgId,
        actor,
      );
      expect(completion.status).toBe('COMPLETED');

      // Non-payroll control expense: its payment must still be counted.
      const controlExpense = await expenses.create(
        {
          labelId: controlLabelId,
          description: 'Gasto de control (no nómina)',
          date: DATE_CASH_FLOW,
          total: Number(CONTROL_EXPENSE_TOTAL),
          payments: [
            {
              amount: Number(CONTROL_EXPENSE_TOTAL),
              method: PaymentMethod.CASH,
              date: DATE_CASH_FLOW,
            },
          ],
        },
        userId as string,
        orgId,
      );
      expect(controlExpense.total.toFixed(2)).toBe(CONTROL_EXPENSE_TOTAL);

      const rangeStart = parseBogotaStartOfDay(CASH_FLOW_START)!;
      const rangeEnd = parseBogotaEndOfDay(CASH_FLOW_END)!;

      const cashFlow = await reports.getCashFlow(
        orgId,
        CASH_FLOW_START,
        CASH_FLOW_END,
      );

      // 50.00 payroll cash + 20.00 control expense. The mirrored 50.00 expense
      // payment is excluded, so a double count would read 120.00 / 3 payments.
      expect(cashFlow.accountingBasis).toBe('CASH_BY_PAYMENT_DATE');
      expect(cashFlow.expensePayments.total).toBe('70.00');
      expect(cashFlow.expensePayments.byPaymentMethod).toEqual([
        { paymentMethod: PaymentMethod.CASH, total: '70.00', count: 2 },
      ]);
      expect(cashFlow.collections.total).toBe('0.00');

      // A DATE-only payroll outflow must appear on its actual Bogotá calendar
      // day, including when that day is both edges of the requested range.
      const singleDay = await reports.getCashFlow(
        orgId,
        DATE_CASH_FLOW,
        DATE_CASH_FLOW,
      );
      expect(singleDay.expensePayments.total).toBe(CASH_FLOW_TOTAL);
      expect(singleDay.expensePayments.byPaymentMethod).toEqual([
        { paymentMethod: PaymentMethod.CASH, total: CASH_FLOW_TOTAL, count: 1 },
      ]);
      const precedingDay = await reports.getCashFlow(
        orgId,
        '2026-06-09',
        '2026-06-09',
      );
      expect(precedingDay.expensePayments.total).toBe(CONTROL_EXPENSE_TOTAL);
      expect(precedingDay.expensePayments.byPaymentMethod).toEqual([
        {
          paymentMethod: PaymentMethod.CASH,
          total: CONTROL_EXPENSE_TOTAL,
          count: 1,
        },
      ]);

      // The mirror really exists in the same window; only the report predicate
      // excludes it, so this is not a "nothing was written" accident.
      const mirrored = await prisma.expensePayment.findMany({
        where: {
          organizationId: orgId,
          date: { gte: rangeStart, lte: rangeEnd },
          expense: { payrollObligationExpense: { isNot: null } },
        },
      });
      expect(mirrored).toHaveLength(1);
      expect(mirrored[0].amount.toFixed(2)).toBe(CASH_FLOW_TOTAL);
      expect(mirrored[0].expenseId).not.toBe(controlExpense.id);

      const counted = await prisma.expensePayment.findMany({
        where: {
          organizationId: orgId,
          date: { gte: rangeStart, lte: rangeEnd },
          expense: { payrollObligationExpense: { is: null } },
        },
      });
      expect(counted).toHaveLength(1);
      expect(counted[0].amount.toFixed(2)).toBe(CONTROL_EXPENSE_TOTAL);

      const outflows = await prisma.payrollCashOutflow.findMany({
        where: {
          organizationId: orgId,
          date: { gte: rangeStart, lte: rangeEnd },
        },
      });
      expect(outflows).toHaveLength(1);
      expect(outflows[0].amount.toFixed(2)).toBe(CASH_FLOW_TOTAL);
      expect(outflows[0].employeeId).toBe(employeeCashFlowId);
    }, 60000);

    it('5. production lock order cannot cycle by itself; an intentional reverse-order AB-BA is a real deadlock that leaves no partial money behind', async () => {
      // (a) Production-only attempt at an AB-BA. Two real completions share the
      // Employee row and are started at the same time in opposite order. Every
      // payroll writer takes that employee lock first, so PostgreSQL serialises
      // them instead of forming a cycle.
      const productionOnly = await Promise.all([
        periodInstallments.create(
          {
            employeeId: employeeDeadlockId,
            obligationId: deadlockObligationAId,
            amount: DEADLOCK_TOTAL_A,
            date: DATE_DEADLOCK,
            method: PaymentMethod.CASH,
          },
          orgId,
          actor,
        ),
        periodInstallmentsSecond.create(
          {
            employeeId: employeeDeadlockId,
            obligationId: deadlockObligationBId,
            amount: DEADLOCK_TOTAL_B,
            date: DATE_DEADLOCK,
            method: PaymentMethod.CASH,
          },
          orgId,
          actor,
        ),
      ]);
      expect(productionOnly.map((result) => result.status)).toEqual([
        'COMPLETED',
        'COMPLETED',
      ]);
      console.log(
        '[payroll-pg-int] production-order attempt: two concurrent completions on one employee serialised, no deadlock and no lost payment',
      );

      const deadlockObligations = await prisma.payrollObligation.findMany({
        where: { organizationId: orgId, employeeId: employeeDeadlockId },
        orderBy: { periodAmount: 'asc' },
      });
      expect(deadlockObligations.map((row) => row.status)).toEqual([
        'COMPLETED',
        'COMPLETED',
      ]);
      expect(deadlockObligations.map((row) => row.version)).toEqual([1, 1]);
      const deadlockOutflows = await prisma.payrollCashOutflow.findMany({
        where: { organizationId: orgId, employeeId: employeeDeadlockId },
        orderBy: { amount: 'asc' },
      });
      expect(deadlockOutflows.map((row) => row.amount.toFixed(2))).toEqual([
        DEADLOCK_TOTAL_A,
        DEADLOCK_TOTAL_B,
      ]);
      const deadlockLinks = await prisma.payrollObligationExpense.findMany({
        where: { organizationId: orgId, employeeId: employeeDeadlockId },
      });
      expect(deadlockLinks).toHaveLength(2);
      expect(new Set(deadlockLinks.map((row) => row.expenseId)).size).toBe(2);

      // (b) A genuine AB-BA needs an order the production code never uses:
      // obligation first, employee second. The intruder takes the obligation,
      // the production completion takes the employee and blocks on the
      // obligation, and the intruder then asks for the employee.
      let releaseIntruder = (): void => {};
      const intruderMayProceed = new Promise<void>((resolve) => {
        releaseIntruder = resolve;
      });
      let intruderHoldsObligation = (): void => {};
      const intruderLockedObligation = new Promise<void>((resolve) => {
        intruderHoldsObligation = resolve;
      });

      const intruder = prismaSecond.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "PayrollObligation"
            WHERE "id" = ${intruderObligationId}
            AND "organizationId" = ${orgId} FOR UPDATE`;
          if (!locked.length) throw new Error('Intruder could not lock');
          intruderHoldsObligation();
          await intruderMayProceed;
          await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "Employee"
            WHERE "id" = ${employeeIntruderId}
            AND "organizationId" = ${orgId} FOR UPDATE`;
          return 'intruder survived';
        },
        { timeout: 30000, maxWait: 30000 },
      );
      const settledIntruder = intruder.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await intruderLockedObligation;
      const completion = periodInstallments.create(
        {
          employeeId: employeeIntruderId,
          obligationId: intruderObligationId,
          amount: INTRUDER_TOTAL,
          date: DATE_INTRUDER,
          method: PaymentMethod.CASH,
        },
        orgId,
        actor,
      );
      const settledCompletion = completion.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      let waited = 0;
      let waitFailure: unknown;
      try {
        // PostgreSQL reports the production backend blocked on the obligation
        // row before the intruder closes the cycle.
        waited = await waitForLockWaiter(
          prismaProbe,
          '%"PayrollObligation"%',
          15000,
        );
      } catch (error) {
        waitFailure = error;
      } finally {
        // Never leave a transaction holding a row lock into the next scenario.
        releaseIntruder();
      }

      const intruderResult = await settledIntruder;
      const completionResult = await settledCompletion;
      if (waitFailure) throw asError(waitFailure, 'Lock wait probe failed');
      expect(waited).toBeGreaterThan(0);

      // PostgreSQL resolves the cycle by killing one participant. Which one is
      // PostgreSQL's choice, not this suite's, so the exact victim is reported
      // and asserted instead of assumed. In every observed run it killed the
      // blocked production completion and the reverse-order intruder survived,
      // so both outcomes are handled and only one of them may happen.
      const failures: { side: string; error: unknown }[] = [];
      if (!intruderResult.ok)
        failures.push({
          side: 'reverse-order intruder',
          error: intruderResult.error,
        });
      if (!completionResult.ok)
        failures.push({
          side: 'production completion',
          error: completionResult.error,
        });
      expect(failures).toHaveLength(1);
      const victim = failures[0];
      console.log(
        `[payroll-pg-int] PostgreSQL deadlock victim: ${victim.side} -> ${describeDatabaseError(victim.error)}`,
      );
      // The observed evidence has to be PostgreSQL's own deadlock, not a
      // client-side transaction or lock-wait timeout.
      expect(deadlockEvidence(victim.error)).toMatch(/40P01|deadlock/i);
      expect(deadlockEvidence(victim.error)).not.toMatch(/P2028/);

      const request = {
        employeeId: employeeIntruderId,
        obligationId: intruderObligationId,
        amount: INTRUDER_TOTAL,
        date: DATE_INTRUDER,
        method: PaymentMethod.CASH,
      };
      const afterDeadlock = await prisma.payrollObligation.findUniqueOrThrow({
        where: { id: intruderObligationId },
      });
      const afterDeadlockOutflows = await prisma.payrollCashOutflow.count({
        where: { organizationId: orgId, employeeId: employeeIntruderId },
      });
      const afterDeadlockLinks = await prisma.payrollObligationExpense.count({
        where: { organizationId: orgId, obligationId: intruderObligationId },
      });
      if (!completionResult.ok) {
        // The production transaction was the victim: nothing of it survived,
        // and the retry below is what has to commit consistently.
        expect(afterDeadlock.status).toBe('PENDING');
        expect(afterDeadlock.version).toBe(0);
        expect(afterDeadlockOutflows).toBe(0);
        expect(afterDeadlockLinks).toBe(0);
        const retried = await periodInstallments.create(request, orgId, actor);
        expect(retried.status).toBe('COMPLETED');
        console.log(
          '[payroll-pg-int] deadlock victim was the production completion: its retry committed',
        );
      } else {
        expect(completionResult.value.status).toBe('COMPLETED');
        console.log(
          '[payroll-pg-int] deadlock survivor: the production completion committed',
        );
      }

      // Whatever PostgreSQL killed, the committed state is consistent: one cash
      // outflow, one installment, no duplicate expense, one link and a valid
      // obligation status.
      const survivorObligation =
        await prisma.payrollObligation.findUniqueOrThrow({
          where: { id: intruderObligationId },
        });
      expect(survivorObligation.status).toBe('COMPLETED');
      expect(survivorObligation.version).toBe(1);
      const survivorOutflows = await prisma.payrollCashOutflow.findMany({
        where: { organizationId: orgId, employeeId: employeeIntruderId },
      });
      expect(survivorOutflows).toHaveLength(1);
      expect(survivorOutflows[0].amount.toFixed(2)).toBe(INTRUDER_TOTAL);
      expect(survivorOutflows[0].method).toBe(PaymentMethod.CASH);
      const survivorInstallments = await prisma.payrollInstallment.findMany({
        where: {
          organizationId: orgId,
          obligationId: intruderObligationId,
        },
      });
      expect(survivorInstallments).toHaveLength(1);
      expect(survivorInstallments[0].outflowId).toBe(survivorOutflows[0].id);
      const survivorLinks = await prisma.payrollObligationExpense.findMany({
        where: {
          organizationId: orgId,
          obligationId: intruderObligationId,
        },
      });
      expect(survivorLinks).toHaveLength(1);
      const survivorExpense = await prisma.expense.findUniqueOrThrow({
        where: { id: survivorLinks[0].expenseId },
        include: { payments: true },
      });
      expect(survivorExpense.total.toFixed(2)).toBe(INTRUDER_TOTAL);
      expect(survivorExpense.payments).toHaveLength(1);
      expect(survivorExpense.payments[0].amount.toFixed(2)).toBe(
        INTRUDER_TOTAL,
      );
      expect(
        await prisma.payrollObligationExpense.count({
          where: {
            organizationId: orgId,
            expenseId: survivorExpense.id,
          },
        }),
      ).toBe(1);
      // No duplicate expense: the victim wrote none and the survivor wrote one,
      // which is the only 90.00 expense of this tenant.
      await expect(
        prisma.expense.count({
          where: {
            organizationId: orgId,
            total: new Prisma.Decimal(INTRUDER_TOTAL),
          },
        }),
      ).resolves.toBe(1);
      const survivorAudits = await prisma.auditLog.count({
        where: {
          organizationId: orgId,
          resource: 'Expense',
          resourceId: survivorExpense.id,
        },
      });
      expect(survivorAudits).toBe(1);
    }, 90000);

    it('6. a lock waiter that outlives Prisma interactive transaction timeout: real error, nothing written, clean retry', async () => {
      // (a) Controlled probe: an interactive transaction with an explicit 750 ms
      // budget, blocked on a real row lock held by another transaction.
      let releaseRowHolder = (): void => {};
      const rowHolderMayFinish = new Promise<void>((resolve) => {
        releaseRowHolder = resolve;
      });
      let rowHolderHoldsLock = (): void => {};
      const rowHolderLocked = new Promise<void>((resolve) => {
        rowHolderHoldsLock = resolve;
      });

      const rowHolder = prismaSecond.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "PayrollObligation"
            WHERE "id" = ${timeoutObligationId}
            AND "organizationId" = ${orgId} FOR UPDATE`;
          if (!locked.length) throw new Error('Holder could not lock');
          rowHolderHoldsLock();
          await rowHolderMayFinish;
          return 'holder committed';
        },
        { timeout: 60000, maxWait: 30000 },
      );
      const settledRowHolder = rowHolder.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await rowHolderLocked;

      const shortWait = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "PayrollObligation"
            WHERE "id" = ${timeoutObligationId}
            AND "organizationId" = ${orgId} FOR UPDATE`;
          return 'acquired';
        },
        { timeout: 750, maxWait: 2000 },
      );
      const settledShortWait = shortWait.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      let shortWaited = 0;
      let shortWaitFailure: unknown;
      try {
        shortWaited = await waitForLockWaiter(
          prismaProbe,
          '%"PayrollObligation"%',
          5000,
        );
      } catch (error) {
        shortWaitFailure = error;
      }

      // Does the client-side budget settle the promise while the statement is
      // still blocked in PostgreSQL? Observed, not assumed.
      const shortRaced = await Promise.race([
        settledShortWait.then((result) => ({ settled: true as const, result })),
        delay(2500).then(() => ({ settled: false as const })),
      ]);
      console.log(
        `[payroll-pg-int] an expired 750 ms interactive transaction settled while its statement was still blocked: ${String(shortRaced.settled)}`,
      );
      // Observed behaviour, asserted: the client-side budget does not interrupt a
      // statement that is already blocked in PostgreSQL.
      expect(shortRaced.settled).toBe(false);
      // Release and settle unconditionally, so this scenario can never leak a
      // held row lock into the next one.
      releaseRowHolder();
      const rowHolderResult = await settledRowHolder;
      const shortResult = shortRaced.settled
        ? shortRaced.result
        : await settledShortWait;
      if (shortWaitFailure)
        throw asError(shortWaitFailure, 'Lock wait probe failed');
      expect(shortWaited).toBeGreaterThan(0);
      expect(rowHolderResult.ok).toBe(true);
      if (shortResult.ok)
        throw new Error('An expired interactive transaction reported success');
      console.log(
        `[payroll-pg-int] 750 ms interactive transaction after release: ${describeDatabaseError(shortResult.error)}`,
      );
      expect(deadlockEvidence(shortResult.error)).toMatch(/P2028/);

      // (b) The production completion, with Prisma's default interactive
      // transaction budget, blocked at the writer's taxonomy lock: the payroll
      // label is held FOR UPDATE by another transaction, so the cash outflow, the
      // installment and the allocations of this transaction are already written
      // when the deadline passes. This is the money-relevant case: the expired
      // transaction must not leave that work behind.
      let releaseLabelHolder = (): void => {};
      const labelHolderMayFinish = new Promise<void>((resolve) => {
        releaseLabelHolder = resolve;
      });
      let labelHolderHoldsLock = (): void => {};
      const labelHolderLocked = new Promise<void>((resolve) => {
        labelHolderHoldsLock = resolve;
      });
      const labelHolder = prismaSecond.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "ExpenseLabel"
            WHERE "id" = ${labelId}
            AND "organizationId" = ${orgId} FOR UPDATE`;
          if (!locked.length) throw new Error('Label holder could not lock');
          labelHolderHoldsLock();
          await labelHolderMayFinish;
          return 'label holder committed';
        },
        { timeout: 60000, maxWait: 30000 },
      );
      const settledLabelHolder = labelHolder.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await labelHolderLocked;

      const interrupted = periodInstallments.create(
        {
          employeeId: employeeTimeoutId,
          obligationId: timeoutObligationId,
          amount: TIMEOUT_TOTAL,
          date: DATE_TIMEOUT,
          method: PaymentMethod.CASH,
        },
        orgId,
        actor,
      );
      const settledInterrupted = interrupted.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      // The blocked statement is the writer's own `ExpenseLabel ... FOR UPDATE`,
      // which it takes before re-reading the label's `active` flag.
      let interruptedWaited = 0;
      let interruptedWaitFailure: unknown;
      try {
        interruptedWaited = await waitForLockWaiter(
          prismaProbe,
          '%"ExpenseLabel"%',
          5000,
        );
      } catch (error) {
        interruptedWaitFailure = error;
      }
      const interruptedRaced = await Promise.race([
        settledInterrupted.then((result) => ({
          settled: true as const,
          result,
        })),
        delay(6500).then(() => ({ settled: false as const })),
      ]);
      console.log(
        `[payroll-pg-int] the production completion settled while its taxonomy lock was still blocked: ${String(interruptedRaced.settled)}`,
      );
      expect(interruptedRaced.settled).toBe(false);
      releaseLabelHolder();
      const labelHolderResult = await settledLabelHolder;
      const interruptedResult = interruptedRaced.settled
        ? interruptedRaced.result
        : await settledInterrupted;
      if (interruptedWaitFailure)
        throw asError(interruptedWaitFailure, 'Lock wait probe failed');
      expect(interruptedWaited).toBeGreaterThan(0);
      expect(labelHolderResult.ok).toBe(true);
      console.log(
        `[payroll-pg-int] production completion after its interactive transaction expired: ${interruptedResult.ok ? 'unexpectedly fulfilled' : describeDatabaseError(interruptedResult.error)}`,
      );
      if (interruptedResult.ok)
        throw new Error(
          'The completion must not report success after its transaction budget expired',
        );
      // The direct probe above establishes Prisma's P2028; the production service
      // translates it to a safe service-unavailable response without raw details.
      expect(interruptedResult.error).toMatchObject({
        status: 503,
        message:
          'No se pudo confirmar la operación. Verifique su estado antes de reintentar',
      });

      // Nothing of the expired completion may survive, including the cash and the
      // installment it had already inserted before the block.
      await delay(500);
      const timeoutObligation =
        await prisma.payrollObligation.findUniqueOrThrow({
          where: { id: timeoutObligationId },
        });
      expect(timeoutObligation.status).toBe('PENDING');
      expect(timeoutObligation.version).toBe(0);
      await expect(
        prisma.payrollCashOutflow.count({
          where: { organizationId: orgId, employeeId: employeeTimeoutId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollInstallment.count({
          where: { organizationId: orgId, obligationId: timeoutObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollObligationExpense.count({
          where: { organizationId: orgId, obligationId: timeoutObligationId },
        }),
      ).resolves.toBe(0);

      // Recovery: the same request succeeds once the lock is free, so both
      // expired attempts left nothing that blocks or duplicates the payment.
      const retried = await periodInstallments.create(
        {
          employeeId: employeeTimeoutId,
          obligationId: timeoutObligationId,
          amount: TIMEOUT_TOTAL,
          date: DATE_TIMEOUT,
          method: PaymentMethod.CASH,
        },
        orgId,
        actor,
      );
      expect(retried.status).toBe('COMPLETED');
      const finalObligation = await prisma.payrollObligation.findUniqueOrThrow({
        where: { id: timeoutObligationId },
      });
      expect(finalObligation.version).toBe(1);
      await expect(
        prisma.payrollCashOutflow.count({
          where: { organizationId: orgId, employeeId: employeeTimeoutId },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.payrollObligationExpense.count({
          where: { organizationId: orgId, obligationId: timeoutObligationId },
        }),
      ).resolves.toBe(1);
    }, 90000);

    it('7. taxonomy deactivation race: forced between the category read and the expense write, and forced to compete for the writer group and label locks', async () => {
      const expensesBeforePhaseA = await prisma.expense.count({
        where: { organizationId: orgId },
      });

      // Phase A: the deactivation commits between the production category read
      // and the production expense write, inside one real transaction that holds
      // the tenant organization lock. No taxonomy lock stops the deactivation.
      const phaseA = await prisma
        .$transaction(
          async (tx) => {
            const category = await resolvePayrollExpenseCategoryWithin(
              tx,
              orgId,
              actor,
            );
            await prismaSecond.expenseLabel.update({
              where: { id: labelId },
              data: { active: false },
            });
            return writePayrollCompletionExpense(tx, {
              organizationId: orgId as string,
              employeeId: employeeTaxonomyId,
              obligationId: taxonomyBeforeWriteObligationId,
              actor,
              category,
              facts: completionFacts(
                TAXONOMY_TOTAL_BEFORE_WRITE,
                DATE_TAXONOMY,
                TEST_OWNED_OUTFLOW_A,
              ),
            });
          },
          { timeout: 30000, maxWait: 30000 },
        )
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      if (phaseA.ok)
        throw new Error(
          'The deactivation between the category read and the expense write was not detected',
        );
      console.log(
        `[payroll-pg-int] deactivation between the category read and the expense write: ${phaseA.error instanceof Error ? phaseA.error.constructor.name : 'non-Error'}: ${phaseA.error instanceof Error ? phaseA.error.message : String(phaseA.error)}`,
      );
      expect(phaseA.error).toBeInstanceOf(ConflictException);
      const deactivatedLabel = await prisma.expenseLabel.findUniqueOrThrow({
        where: { id: labelId },
      });
      expect(deactivatedLabel.active).toBe(false);
      // The completion is fail-closed: no expense and no link survive.
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBeforePhaseA);
      await expect(
        prisma.payrollObligationExpense.count({
          where: { obligationId: taxonomyBeforeWriteObligationId },
        }),
      ).resolves.toBe(0);

      await prisma.expenseLabel.update({
        where: { id: labelId },
        data: { active: true },
      });

      // Phase B: the deactivation is in flight and uncommitted when the writer
      // asks for its taxonomy lock. This is the ordering that used to commit an
      // expense bound to a label that was already inactive. The writer now takes
      // `ExpenseLabel ... FOR UPDATE` on the bound label before re-reading it, so
      // the two taxonomy writers serialize: the writer waits for the deactivation
      // to commit, its post-lock re-read then sees `active = false`, and the
      // completion fails closed instead of binding an expense to a dead label.
      let deactivationHoldsLock = (): void => {};
      const deactivationLocked = new Promise<void>((resolve) => {
        deactivationHoldsLock = resolve;
      });
      let releaseDeactivation = (): void => {};
      const deactivationGate = new Promise<void>((resolve) => {
        releaseDeactivation = resolve;
      });

      const deactivation = prismaSecond.$transaction(
        async (tx) => {
          await tx.expenseLabel.update({
            where: { id: labelId },
            data: { active: false },
          });
          deactivationHoldsLock();
          await deactivationGate;
          return 'deactivated' as const;
        },
        { timeout: 30000, maxWait: 30000 },
      );
      await deactivationLocked;

      let writerReachedCategory = (): void => {};
      const writerAtCategory = new Promise<void>((resolve) => {
        writerReachedCategory = resolve;
      });

      const phaseB = prisma
        .$transaction(
          async (tx) => {
            const category = await resolvePayrollExpenseCategoryWithin(
              tx,
              orgId,
              actor,
            );
            writerReachedCategory();
            return writePayrollCompletionExpense(tx, {
              organizationId: orgId as string,
              employeeId: employeeTaxonomyId,
              obligationId: taxonomyAfterWriteObligationId,
              actor,
              category,
              facts: completionFacts(
                TAXONOMY_TOTAL_AFTER_WRITE,
                DATE_TAXONOMY,
                TEST_OWNED_OUTFLOW_B,
              ),
            });
          },
          { timeout: 30000, maxWait: 30000 },
        )
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );

      await writerAtCategory;
      // PostgreSQL reports the writer blocked on the `ExpenseLabel` row the
      // deactivation holds: the lock is real and it is that same row.
      await waitForLockWaiter(prismaProbe, '%"ExpenseLabel"%', 10000);
      releaseDeactivation();
      await expect(deactivation).resolves.toBe('deactivated');

      const phaseBResult = await phaseB;
      if (phaseBResult.ok)
        throw new Error(
          `The writer committed an expense after the deactivation: ${phaseBResult.value.kind}`,
        );
      console.log(
        `[payroll-pg-int] deactivation serialized with the writer label lock: ${describeDatabaseError(phaseBResult.error)}`,
      );
      expect(phaseBResult.error).toBeInstanceOf(ConflictException);
      const boundLabel = await prisma.expenseLabel.findUniqueOrThrow({
        where: { id: labelId },
      });
      // Fail-closed, and no residue: the deactivation is the state the writer
      // observed, and neither an expense nor a link was committed for it.
      expect(boundLabel.active).toBe(false);
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBeforePhaseA);
      await expect(
        prisma.payrollObligationExpense.count({
          where: {
            obligationId: {
              in: [
                taxonomyBeforeWriteObligationId,
                taxonomyAfterWriteObligationId,
              ],
            },
          },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollObligation.findUniqueOrThrow({
          where: { id: taxonomyAfterWriteObligationId },
          select: { status: true, version: true },
        }),
      ).resolves.toEqual({ status: 'PENDING', version: 0 });

      await prisma.expenseLabel.update({
        where: { id: labelId },
        data: { active: true },
      });

      // Phase C: the *group* deactivation race. `ExpenseTaxonomyService.removeGroup`
      // deactivates the whole group with a plain row update as well, so the label
      // lock alone never covered this ordering: a group deactivation committed
      // after the post-lock re-read and before the commit could bind an expense to
      // an already inactive group. The writer now locks the parent `ExpenseGroup`
      // row in the same tenant-scoped statement as the label, so the two writers
      // serialize on the group row itself.
      let groupDeactivationHoldsLock = (): void => {};
      const groupDeactivationLocked = new Promise<void>((resolve) => {
        groupDeactivationHoldsLock = resolve;
      });
      let releaseGroupDeactivation = (): void => {};
      const groupDeactivationGate = new Promise<void>((resolve) => {
        releaseGroupDeactivation = resolve;
      });

      const groupDeactivation = prismaSecond.$transaction(
        async (tx) => {
          await tx.expenseGroup.update({
            where: { id: expenseGroupId },
            data: { active: false },
          });
          groupDeactivationHoldsLock();
          await groupDeactivationGate;
          return 'group-deactivated' as const;
        },
        { timeout: 30000, maxWait: 30000 },
      );
      await groupDeactivationLocked;

      let writerAtGroupCategory = (): void => {};
      const writerReachedGroupCategory = new Promise<void>((resolve) => {
        writerAtGroupCategory = resolve;
      });

      const phaseC = prisma
        .$transaction(
          async (tx) => {
            const category = await resolvePayrollExpenseCategoryWithin(
              tx,
              orgId,
              actor,
            );
            writerAtGroupCategory();
            return writePayrollCompletionExpense(tx, {
              organizationId: orgId as string,
              employeeId: employeeTaxonomyId,
              obligationId: taxonomyGroupObligationId,
              actor,
              category,
              facts: completionFacts(
                TAXONOMY_TOTAL_AFTER_GROUP_WRITE,
                DATE_TAXONOMY,
                TEST_OWNED_OUTFLOW_C,
              ),
            });
          },
          { timeout: 30000, maxWait: 30000 },
        )
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );

      await writerReachedGroupCategory;
      // PostgreSQL reports the writer blocked on the `ExpenseGroup` row the
      // deactivation holds: the parent lock is real and it is that same row, not
      // only the label one phase B proves.
      await waitForLockWaiter(prismaProbe, '%"ExpenseGroup"%', 10000);
      releaseGroupDeactivation();
      await expect(groupDeactivation).resolves.toBe('group-deactivated');

      const phaseCResult = await phaseC;
      if (phaseCResult.ok)
        throw new Error(
          `The writer committed an expense after the group deactivation: ${phaseCResult.value.kind}`,
        );
      console.log(
        `[payroll-pg-int] group deactivation serialized with the writer group lock: ${describeDatabaseError(phaseCResult.error)}`,
      );
      expect(phaseCResult.error).toBeInstanceOf(ConflictException);
      const deactivatedGroup = await prisma.expenseGroup.findUniqueOrThrow({
        where: { id: expenseGroupId },
      });
      // Fail-closed, and no residue: the group deactivation is the state the
      // writer observed after its lock was granted, so nothing was written.
      expect(deactivatedGroup.active).toBe(false);
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBeforePhaseA);
      await expect(
        prisma.payrollObligationExpense.count({
          where: { obligationId: taxonomyGroupObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollObligation.findUniqueOrThrow({
          where: { id: taxonomyGroupObligationId },
          select: { status: true, version: true },
        }),
      ).resolves.toEqual({ status: 'PENDING', version: 0 });

      await prisma.expenseGroup.update({
        where: { id: expenseGroupId },
        data: { active: true },
      });
    }, 90000);

    it('8. cross-tenant isolation: tenant A can neither read nor mutate tenant B obligations, installments, cash or expenses', async () => {
      const tenantSnapshot = async (targetOrgId: string) => {
        const [
          obligationRows,
          installmentRows,
          outflowRows,
          expenseRows,
          linkRows,
        ] = await Promise.all([
          prisma.payrollObligation.findMany({
            where: { organizationId: targetOrgId },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              employeeId: true,
              status: true,
              version: true,
              periodAmount: true,
            },
          }),
          prisma.payrollInstallment.findMany({
            where: { organizationId: targetOrgId },
            orderBy: { id: 'asc' },
            select: { id: true, obligationId: true, outflowId: true },
          }),
          prisma.payrollCashOutflow.findMany({
            where: { organizationId: targetOrgId },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              employeeId: true,
              amount: true,
              date: true,
              method: true,
            },
          }),
          prisma.expense.findMany({
            where: { organizationId: targetOrgId },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              total: true,
              date: true,
              active: true,
              status: true,
              labelId: true,
              description: true,
              payments: {
                orderBy: { id: 'asc' },
                select: { id: true, amount: true, date: true, method: true },
              },
            },
          }),
          prisma.payrollObligationExpense.findMany({
            where: { organizationId: targetOrgId },
            orderBy: { obligationId: 'asc' },
          }),
        ]);
        return JSON.parse(
          JSON.stringify({
            obligations: obligationRows,
            installments: installmentRows,
            outflows: outflowRows,
            expenses: expenseRows,
            links: linkRows,
          }),
        ) as unknown;
      };

      const tenantABefore = await tenantSnapshot(orgId as string);
      const tenantBBefore = await tenantSnapshot(orgBId as string);

      // Read isolation: A's projection never carries B's obligations or cash, and
      // filtering by B's employee inside A's tenant yields nothing.
      const readA = await obligations.findAll(orgId);
      const obligationIdsA = readA.map((row) => row.id);
      expect(obligationIdsA).not.toContain(tenantBPendingObligationId);
      expect(obligationIdsA).not.toContain(tenantBCompletedObligationId);
      const outflowIdsA = readA.flatMap((row) =>
        row.installments.map((installment) => installment.outflow.id),
      );
      expect(outflowIdsA).not.toContain(tenantBPendingOutflowId);
      expect(outflowIdsA).not.toContain(tenantBCompletedOutflowId);
      await expect(
        obligations.findAll(orgId, employeeTenantBId),
      ).resolves.toEqual([]);
      await expect(obligations.findAll(undefined)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(obligations.findAll('')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      const readB = await obligations.findAll(orgBId);
      expect(readB.map((row) => row.id)).toEqual(
        expect.arrayContaining([
          tenantBPendingObligationId,
          tenantBCompletedObligationId,
        ]),
      );
      const installmentIdsB = readB.flatMap((row) =>
        row.installments.map((installment) => installment.id),
      );
      expect(installmentIdsB).toEqual(
        expect.arrayContaining([
          tenantBPendingInstallmentId,
          tenantBCompletedInstallmentId,
        ]),
      );
      expect(
        readB.find((row) => row.id === tenantBPendingObligationId)?.summary,
      ).toMatchObject({
        total: ISOLATION_TOTAL_B_PENDING,
        paid: ISOLATION_PAID_B,
        status: 'pending',
      });

      // Mutations in both directions. Each one has to be refused by the
      // tenant-scoped lookup or by the actor/organization match, before any
      // payroll, cash or expense row is reached.
      const crossTenantAttempts = [
        {
          label: "A tenant with B's obligation",
          expected: NotFoundException,
          run: () =>
            periodInstallments.create(
              {
                employeeId: employeeTenantBId,
                obligationId: tenantBPendingObligationId,
                amount: '10.00',
                date: DATE_ISOLATION,
                method: PaymentMethod.CASH,
              },
              orgId,
              actor,
            ),
        },
        {
          label: "A actor on B's organization",
          expected: ForbiddenException,
          run: () =>
            periodInstallments.create(
              {
                employeeId: employeeTenantBId,
                obligationId: tenantBPendingObligationId,
                amount: '10.00',
                date: DATE_ISOLATION,
                method: PaymentMethod.CASH,
              },
              orgBId,
              actor,
            ),
        },
        {
          label: "A employee with B's obligation",
          expected: NotFoundException,
          run: () =>
            periodInstallments.create(
              {
                employeeId: employeeCrossTenantId,
                obligationId: tenantBPendingObligationId,
                amount: '10.00',
                date: DATE_ISOLATION,
                method: PaymentMethod.CASH,
              },
              orgId,
              actor,
            ),
        },
        {
          label: "correction aiming at B's installment from A",
          expected: NotFoundException,
          run: () =>
            correction.correct(
              {
                employeeId: employeeCrossTenantId,
                obligationId: crossTenantObligationAId,
                installmentId: tenantBPendingInstallmentId,
                amount: '20.00',
              },
              orgId,
              actor,
            ),
        },
        {
          label: "A actor correcting inside B's tenant",
          expected: ForbiddenException,
          run: () =>
            correction.correct(
              {
                employeeId: employeeTenantBId,
                obligationId: tenantBPendingObligationId,
                installmentId: tenantBPendingInstallmentId,
                amount: '20.00',
              },
              orgBId,
              actor,
            ),
        },
        {
          label: 'read a B expense',
          expected: NotFoundException,
          run: () => expenses.findOne(tenantBExpenseId, orgId),
        },
        {
          label: 'update a B expense',
          expected: NotFoundException,
          run: () =>
            expenses.update(
              tenantBExpenseId,
              { description: 'mutado por el otro tenant' },
              userId as string,
              orgId,
            ),
        },
        {
          label: 'pay a B expense',
          expected: NotFoundException,
          run: () =>
            expenses.addPayment(
              tenantBExpenseId,
              {
                amount: 1,
                method: PaymentMethod.CASH,
                date: DATE_ISOLATION,
              },
              userId as string,
              orgId,
            ),
        },
        {
          label: 'remove a B expense',
          expected: NotFoundException,
          run: () => expenses.remove(tenantBExpenseId, userId as string, orgId),
        },
        {
          label: 'B mutating an A linked expense',
          expected: NotFoundException,
          run: () =>
            expenses.update(
              concurrentExpenseId,
              { description: 'mutado por el otro tenant' },
              userBId as string,
              orgBId,
            ),
        },
        {
          label: "writer with B's tenant and A's actor",
          expected: ForbiddenException,
          run: () =>
            prismaSecond.$transaction((tx) =>
              writePayrollCompletionExpense(tx, {
                organizationId: orgBId as string,
                employeeId: employeeTenantBId,
                obligationId: tenantBPendingObligationId,
                actor,
                category: {
                  organizationId: orgBId as string,
                  groupId: expenseGroupBId,
                  labelId: labelBId,
                },
                facts: completionFacts(
                  ISOLATION_TOTAL_B_PENDING,
                  DATE_ISOLATION,
                  TEST_OWNED_OUTFLOW_A,
                ),
              }),
            ),
        },
        {
          label: "writer with A's tenant and B's category",
          expected: ConflictException,
          run: () =>
            prismaSecond.$transaction((tx) =>
              writePayrollCompletionExpense(tx, {
                organizationId: orgId as string,
                employeeId: employeeTaxonomyId,
                obligationId: taxonomyBeforeWriteObligationId,
                actor,
                category: {
                  organizationId: orgBId as string,
                  groupId: expenseGroupBId,
                  labelId: labelBId,
                },
                facts: completionFacts(
                  TAXONOMY_TOTAL_BEFORE_WRITE,
                  DATE_TAXONOMY,
                  TEST_OWNED_OUTFLOW_B,
                ),
              }),
            ),
        },
      ];

      const refused: string[] = [];
      for (const attempt of crossTenantAttempts) {
        let failure: unknown;
        try {
          await attempt.run();
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(attempt.expected);
        refused.push(
          `${attempt.label} -> ${
            failure instanceof Error ? failure.message : 'non-Error failure'
          }`,
        );
      }
      console.log(
        `[payroll-pg-int] ${refused.length} cross-tenant attempts refused: ${refused.join(' / ')}`,
      );

      // The only way to a cash row is through a tenant-scoped installment lookup,
      // so B's cash stayed exactly where it was, as did both tenants' rows.
      const tenantBCash = await prisma.payrollCashOutflow.findMany({
        where: { organizationId: orgBId },
        orderBy: { amount: 'asc' },
      });
      expect(tenantBCash.map((row) => row.amount.toFixed(2))).toEqual([
        ISOLATION_PAID_B,
        ISOLATION_TOTAL_B_COMPLETED,
      ]);
      expect(tenantBCash.map((row) => row.id).sort()).toEqual(
        [tenantBPendingOutflowId, tenantBCompletedOutflowId].sort(),
      );
      await expect(tenantSnapshot(orgId as string)).resolves.toEqual(
        tenantABefore,
      );
      await expect(tenantSnapshot(orgBId as string)).resolves.toEqual(
        tenantBBefore,
      );
    }, 60000);

    it('9. two concurrent corrections of one grouped installment: exactly one applies, the loser leaves no void, replacement, revision, cash or status change', async () => {
      const request = {
        employeeId: employeeCorrectionConcurrentId,
        obligationId: correctionConcurrentObligationId,
        installmentId: correctionConcurrentInstallmentId,
        amount: GROUPED_TOTAL,
      };
      const expensesBefore = await prisma.expense.count({
        where: { organizationId: orgId },
      });
      // One installment write already happened, so the version is a baseline this
      // scenario must advance by exactly one - never by two.
      const obligationBefore = await prisma.payrollObligation.findUniqueOrThrow(
        {
          where: { id: correctionConcurrentObligationId },
          select: { status: true, version: true },
        },
      );
      expect(obligationBefore.status).toBe('PENDING');

      // Two services on two clients: two real PostgreSQL backends, each opening its
      // own correction transaction. Both corrections would complete the payment.
      const results = await Promise.allSettled([
        groupCorrection.correct({ ...request }, orgId, actor),
        groupCorrectionSecond.correct({ ...request }, orgId, actor),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The loser serialises on the employee row, re-reads the committed state and
      // fails closed because the payment is no longer pending - not because of a
      // lock-wait artifact.
      const failure = rejected[0].reason as Error;
      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure.message).toBe('Pago no disponible');
      console.log(
        `[payroll-pg-int] concurrent grouped correction loser: ${failure.constructor.name}: ${failure.message}`,
      );

      const obligation = await prisma.payrollObligation.findUniqueOrThrow({
        where: { id: correctionConcurrentObligationId },
      });
      expect(obligation.status).toBe('COMPLETED');
      expect(obligation.version).toBe(obligationBefore.version + 1);

      // One cash row, revised in place: identity, date and method are kept.
      const cash = await prisma.payrollCashOutflow.findMany({
        where: {
          organizationId: orgId,
          employeeId: employeeCorrectionConcurrentId,
        },
      });
      expect(cash).toHaveLength(1);
      expect(cash[0].id).toBe(correctionConcurrentOutflowId);
      expect(cash[0].amount.toFixed(2)).toBe(GROUPED_TOTAL);
      expect(cash[0].date.toISOString().slice(0, 10)).toBe(
        DATE_CORRECTION_CONCURRENT,
      );
      expect(cash[0].method).toBe(PaymentMethod.CASH);

      await expect(
        prisma.payrollInstallment.count({
          where: {
            organizationId: orgId,
            obligationId: correctionConcurrentObligationId,
          },
        }),
      ).resolves.toBe(1);

      // Exactly one void and exactly one replacement set: the loser voided and
      // allocated nothing of its own.
      const voids = await prisma.payrollAllocationVoid.findMany({
        where: {
          organizationId: orgId,
          obligationId: correctionConcurrentObligationId,
        },
      });
      expect(voids).toHaveLength(1);
      // Applications are append-only: the superseded one stays in history, voided,
      // and the two effective ones are the winner's replacement set. A loser that
      // had written anything would show up as extra rows here.
      const allocations = await prisma.payrollAllocation.findMany({
        where: {
          organizationId: orgId,
          obligationId: correctionConcurrentObligationId,
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(allocations).toHaveLength(3);
      const superseded = allocations.filter(
        (row) => row.id === voids[0].allocationId,
      );
      expect(superseded).toHaveLength(1);
      expect(superseded[0].amount.toFixed(2)).toBe(CORRECTION_FIRST_TOTAL);
      const effective = allocations.filter(
        (row) => row.id !== voids[0].allocationId,
      );
      expect(effective.map((row) => row.amount.toFixed(2))).toEqual([
        GROUPED_SHIFT_AMOUNT,
        GROUPED_SHIFT_AMOUNT,
      ]);

      const revisions = await prisma.payrollCashRevision.findMany({
        where: {
          organizationId: orgId,
          installmentId: correctionConcurrentInstallmentId,
        },
      });
      expect(revisions).toHaveLength(1);
      expect(revisions[0].sequence).toBe(1);
      expect(revisions[0].outflowId).toBe(correctionConcurrentOutflowId);
      expect(revisions[0].oldAmount.toFixed(2)).toBe(CORRECTION_FIRST_TOTAL);
      expect(revisions[0].newAmount.toFixed(2)).toBe(GROUPED_TOTAL);

      // This payment stores an explicit "no expense" choice, so completing it must
      // not write one - by either correction.
      await expect(
        prisma.payrollObligationExpense.count({
          where: { obligationId: correctionConcurrentObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBefore);

      // The closed payment stays closed: a later correction is refused too.
      await expect(
        groupCorrection.correct({ ...request, amount: '221.00' }, orgId, actor),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        prisma.payrollCashOutflow.findUniqueOrThrow({
          where: { id: correctionConcurrentOutflowId },
        }),
      ).resolves.toMatchObject({ amount: new Prisma.Decimal(GROUPED_TOTAL) });
    }, 60000);

    it('10. a grouped correction whose completion expense write fails writes nothing, and a failure after its money writes is rolled back by PostgreSQL', async () => {
      // Phase A: the approved fail-closed path. The inactive payroll category makes
      // the in-transaction expense write throw. In this writer the expense is
      // written *before* the voids, the replacement applications, the cash amount,
      // the revision and the status, so the proof here is that the completion fails
      // with no partial write of any of them.
      await prisma.expenseLabel.update({
        where: { id: labelId },
        data: { active: false },
      });
      const expensesBefore = await prisma.expense.count({
        where: { organizationId: orgId },
      });
      const paymentsBefore = await prisma.expensePayment.count({
        where: { organizationId: orgId },
      });
      const auditsBefore = await prisma.auditLog.count({
        where: { organizationId: orgId },
      });
      const request = {
        employeeId: employeeCorrectionRollbackId,
        obligationId: correctionRollbackObligationId,
        installmentId: correctionRollbackInstallmentId,
        amount: GROUPED_TOTAL,
      };
      const rollbackObligationBefore =
        await prisma.payrollObligation.findUniqueOrThrow({
          where: { id: correctionRollbackObligationId },
          select: { status: true, version: true },
        });
      expect(rollbackObligationBefore.status).toBe('PENDING');

      const failure = await (async () => {
        try {
          await groupCorrection.correct({ ...request }, orgId, actor);
          return null;
        } catch (error) {
          return error instanceof Error ? error : new Error('non-Error');
        } finally {
          // Always restore the category, so a failure here cannot cascade into the
          // expense-dependent scenarios that follow.
          await prisma.expenseLabel.update({
            where: { id: labelId },
            data: { active: true },
          });
        }
      })();
      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as Error).message).toContain(
        'La categoría de gasto de nómina está inactiva',
      );

      // Nothing of the failed correction survives: no void, no replacement, no
      // revision, no cash change and no status change.
      await expect(
        prisma.payrollObligation.findUniqueOrThrow({
          where: { id: correctionRollbackObligationId },
          select: { status: true, version: true },
        }),
      ).resolves.toEqual({
        status: 'PENDING',
        version: rollbackObligationBefore.version,
      });
      await expect(
        prisma.payrollCashOutflow.findMany({
          where: {
            organizationId: orgId,
            employeeId: employeeCorrectionRollbackId,
          },
        }),
      ).resolves.toMatchObject([
        { amount: new Prisma.Decimal(CORRECTION_FIRST_TOTAL) },
      ]);
      await expect(
        prisma.payrollAllocationVoid.count({
          where: { obligationId: correctionRollbackObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollAllocation.count({
          where: { obligationId: correctionRollbackObligationId },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.payrollCashRevision.count({
          where: { obligationId: correctionRollbackObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollObligationExpense.count({
          where: { obligationId: correctionRollbackObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBefore);
      await expect(
        prisma.expensePayment.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(paymentsBefore);
      await expect(
        prisma.auditLog.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(auditsBefore);

      // Control: the same correction succeeds once the expense write can succeed, so
      // the failure above left nothing that blocks or duplicates the money.
      const retried = await groupCorrection.correct(
        { ...request },
        orgId,
        actor,
      );
      expect(retried.status).toBe('COMPLETED');
      const completed = await prisma.payrollObligation.findUniqueOrThrow({
        where: { id: correctionRollbackObligationId },
      });
      expect(completed.status).toBe('COMPLETED');
      expect(completed.version).toBe(rollbackObligationBefore.version + 1);
      const rollbackLinks = await prisma.payrollObligationExpense.findMany({
        where: { obligationId: correctionRollbackObligationId },
      });
      expect(rollbackLinks).toHaveLength(1);
      const rollbackExpense = await prisma.expense.findUniqueOrThrow({
        where: { id: rollbackLinks[0].expenseId },
        include: { payments: true },
      });
      expect(rollbackExpense.total.toFixed(2)).toBe(GROUPED_TOTAL);
      expect(rollbackExpense.payments).toHaveLength(1);
      expect(rollbackExpense.payments[0].amount.toFixed(2)).toBe(GROUPED_TOTAL);

      // Phase B: a failure that happens *after* the money writes. The correction
      // writes the completion expense, its payment mirror, its audit row and the
      // obligation/expense link first, then has to void the superseded application.
      // Holding that application FOR UPDATE blocks the void insert, the interactive
      // transaction budget expires while the statement is blocked, and PostgreSQL
      // must discard everything the transaction had already written.
      let releaseAllocation = (): void => {};
      const allocationMayBeReleased = new Promise<void>((resolve) => {
        releaseAllocation = resolve;
      });
      let allocationHoldsLock = (): void => {};
      const allocationLocked = new Promise<void>((resolve) => {
        allocationHoldsLock = resolve;
      });
      const allocationHolder = prismaSecond.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "PayrollAllocation"
            WHERE "id" = ${correctionTimeoutAllocationId}
            AND "organizationId" = ${orgId} FOR UPDATE`;
          if (!locked.length)
            throw new Error('Allocation holder could not lock');
          allocationHoldsLock();
          await allocationMayBeReleased;
          return 'allocation released';
        },
        { timeout: 60000, maxWait: 30000 },
      );
      const settledAllocationHolder = allocationHolder.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await allocationLocked;

      const expensesBeforeTimeout = await prisma.expense.count({
        where: { organizationId: orgId },
      });
      const auditsBeforeTimeout = await prisma.auditLog.count({
        where: { organizationId: orgId },
      });
      const timeoutRequest = {
        employeeId: employeeCorrectionTimeoutId,
        obligationId: correctionTimeoutObligationId,
        installmentId: correctionTimeoutInstallmentId,
        amount: GROUPED_TOTAL,
      };
      const timeoutObligationBefore =
        await prisma.payrollObligation.findUniqueOrThrow({
          where: { id: correctionTimeoutObligationId },
          select: { status: true, version: true },
        });
      expect(timeoutObligationBefore.status).toBe('PENDING');
      const blocked = groupCorrection
        .correct({ ...timeoutRequest }, orgId, actor)
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      let blockedWaited = 0;
      let blockedWaitFailure: unknown;
      try {
        // The blocked statement is the writer's own void insert: the expense of this
        // same completion was already written when it starts waiting.
        blockedWaited = await waitForLockWaiter(
          prismaProbe,
          '%"PayrollAllocationVoid"%',
          10000,
        );
      } catch (error) {
        blockedWaitFailure = error;
      }
      const blockedRaced = await Promise.race([
        blocked.then((result) => ({ settled: true as const, result })),
        delay(6500).then(() => ({ settled: false as const })),
      ]);
      console.log(
        `[payroll-pg-int] the grouped correction settled while its void insert was still blocked: ${String(blockedRaced.settled)}`,
      );
      releaseAllocation();
      const holderResult = await settledAllocationHolder;
      const blockedResult = blockedRaced.settled
        ? blockedRaced.result
        : await blocked;
      if (blockedWaitFailure)
        throw asError(blockedWaitFailure, 'Lock wait probe failed');
      expect(blockedWaited).toBeGreaterThan(0);
      expect(holderResult.ok).toBe(true);
      expect(blockedRaced.settled).toBe(false);
      if (blockedResult.ok)
        throw new Error(
          'The correction must not report success after its transaction budget expired',
        );
      console.log(
        `[payroll-pg-int] grouped correction after its interactive transaction expired: ${describeDatabaseError(blockedResult.error)}`,
      );
      expect(blockedResult.error).toMatchObject({
        status: 503,
        message:
          'No se pudo confirmar la operación. Verifique su estado antes de reintentar',
      });

      // The already-written expense, its mirror, its audit row, the link and the
      // cash are all gone: only the untouched pending payment remains.
      await delay(500);
      await expect(
        prisma.payrollObligation.findUniqueOrThrow({
          where: { id: correctionTimeoutObligationId },
          select: { status: true, version: true },
        }),
      ).resolves.toEqual({
        status: 'PENDING',
        version: timeoutObligationBefore.version,
      });
      await expect(
        prisma.payrollCashOutflow.findMany({
          where: {
            organizationId: orgId,
            employeeId: employeeCorrectionTimeoutId,
          },
        }),
      ).resolves.toMatchObject([
        { amount: new Prisma.Decimal(CORRECTION_FIRST_TOTAL) },
      ]);
      await expect(
        prisma.payrollAllocationVoid.count({
          where: { obligationId: correctionTimeoutObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollAllocation.count({
          where: { obligationId: correctionTimeoutObligationId },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.payrollCashRevision.count({
          where: { obligationId: correctionTimeoutObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollObligationExpense.count({
          where: { obligationId: correctionTimeoutObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBeforeTimeout);
      await expect(
        prisma.auditLog.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(auditsBeforeTimeout);

      // Recovery: the same correction commits once the lock is free, and the expense
      // of that retry is the only one this payment ever gets.
      const timeoutRetried = await groupCorrection.correct(
        { ...timeoutRequest },
        orgId,
        actor,
      );
      expect(timeoutRetried.status).toBe('COMPLETED');
      await expect(
        prisma.payrollObligationExpense.count({
          where: { obligationId: correctionTimeoutObligationId },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBeforeTimeout + 1);
    }, 120000);

    it('11. two concurrent replacements of the same source installment: exactly one succeeds and no second obligation, reference or cash row is created', async () => {
      const request = {
        employeeId: employeeReplacementRaceId,
        sourceObligationId: replacementRaceSourceObligationId,
        installmentIds: [replacementRaceInstallmentId],
        expenseEnabled: false,
      };
      const cashBefore = await prisma.payrollCashOutflow.count({
        where: { organizationId: orgId, employeeId: employeeReplacementRaceId },
      });
      const sourceBefore = await prisma.payrollObligation.findUniqueOrThrow({
        where: { id: replacementRaceSourceObligationId },
        select: { status: true, version: true },
      });
      expect(sourceBefore.status).toBe('COMPLETED');

      // Both replacements reference the same real cash. The writer locks the
      // employee, then the source payment, then the referenced cash row, so the two
      // transactions serialise there and the second sees the committed reference.
      const results = await Promise.allSettled([
        replacement.create({ ...request }, orgId, actor),
        replacementSecond.create({ ...request }, orgId, actor),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const failure = rejected[0].reason as Error;
      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure.message).toBe('El abono ya fue referenciado');
      console.log(
        `[payroll-pg-int] concurrent replacement loser: ${failure.constructor.name}: ${failure.message}`,
      );

      // Exactly one new payment, and it is the pending reference-based one.
      const obligations = await prisma.payrollObligation.findMany({
        where: {
          organizationId: orgId,
          employeeId: employeeReplacementRaceId,
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(obligations).toHaveLength(2);
      const source = obligations.find(
        (row) => row.id === replacementRaceSourceObligationId,
      );
      expect(source).toMatchObject({
        status: sourceBefore.status,
        version: sourceBefore.version,
      });
      const created = obligations.filter(
        (row) => row.id !== replacementRaceSourceObligationId,
      );
      expect(created).toHaveLength(1);
      expect(created[0].kind).toBe('FIXED_PERIOD');
      expect(created[0].status).toBe('PENDING');
      expect(created[0].version).toBe(0);
      expect(created[0].periodAmount?.toFixed(2)).toBe(GROUPED_TOTAL);
      expect(created[0].expenseEnabled).toBe(false);

      const references = await prisma.payrollInstallmentReference.findMany({
        where: {
          organizationId: orgId,
          employeeId: employeeReplacementRaceId,
        },
      });
      expect(references).toHaveLength(1);
      expect(references[0].sourceInstallmentId).toBe(
        replacementRaceInstallmentId,
      );
      expect(references[0].sourceObligationId).toBe(
        replacementRaceSourceObligationId,
      );
      expect(references[0].targetObligationId).toBe(created[0].id);
      expect(references[0].amount.toFixed(2)).toBe(REPLACEMENT_FIRST_TOTAL);

      // Referenced cash is real cash of the source: no new outflow, and the source
      // payment, its installments, applications and revisions are untouched.
      await expect(
        prisma.payrollCashOutflow.count({
          where: {
            organizationId: orgId,
            employeeId: employeeReplacementRaceId,
          },
        }),
      ).resolves.toBe(cashBefore);
      await expect(
        prisma.payrollInstallment.count({
          where: { obligationId: replacementRaceSourceObligationId },
        }),
      ).resolves.toBe(2);
      await expect(
        prisma.payrollAllocationVoid.count({
          where: { obligationId: replacementRaceSourceObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollCashRevision.count({
          where: { obligationId: replacementRaceSourceObligationId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payrollObligationExpense.count({
          where: {
            obligationId: {
              in: [replacementRaceSourceObligationId, created[0].id],
            },
          },
        }),
      ).resolves.toBe(0);
    }, 60000);

    it('12. a reference-based replacement completes exactly once, with one expense when its stored choice is enabled and none when it is disabled', async () => {
      const withExpense = await replacement.create(
        {
          employeeId: employeeReplacementCompleteId,
          sourceObligationId: replacementCompleteSourceObligationId,
          installmentIds: [replacementCompleteExpenseInstallmentId],
          expenseEnabled: true,
        },
        orgId,
        actor,
      );
      expect(withExpense.status).toBe('PENDING');
      expect(withExpense.paid).toBe(REPLACEMENT_FIRST_TOTAL);
      expect(withExpense.balance).toBe(REPLACEMENT_SECOND_TOTAL);

      const withoutExpense = await replacement.create(
        {
          employeeId: employeeReplacementCompleteId,
          sourceObligationId: replacementCompleteSourceObligationId,
          installmentIds: [replacementCompleteNoExpenseInstallmentId],
          expenseEnabled: false,
        },
        orgId,
        actor,
      );
      expect(withoutExpense.status).toBe('PENDING');
      expect(withoutExpense.paid).toBe(REPLACEMENT_SECOND_TOTAL);
      expect(withoutExpense.balance).toBe(REPLACEMENT_FIRST_TOTAL);

      // Creating a replacement registers references, never cash.
      await expect(
        prisma.payrollCashOutflow.count({
          where: {
            organizationId: orgId,
            employeeId: employeeReplacementCompleteId,
          },
        }),
      ).resolves.toBe(2);
      const expensesBefore = await prisma.expense.count({
        where: { organizationId: orgId },
      });

      // Enabled choice: referenced cash plus the completing installment reach the
      // corrected total, so the payment completes and its expense is written once.
      const completionWithExpense = await periodInstallments.create(
        {
          employeeId: employeeReplacementCompleteId,
          obligationId: withExpense.obligation.id,
          amount: REPLACEMENT_SECOND_TOTAL,
          date: DATE_REPLACEMENT_COMPLETE_WITH_EXPENSE,
          method: PaymentMethod.CASH,
        },
        orgId,
        actor,
      );
      expect(completionWithExpense.status).toBe('COMPLETED');
      await expect(
        prisma.payrollObligation.findUniqueOrThrow({
          where: { id: withExpense.obligation.id },
          select: { status: true, version: true },
        }),
      ).resolves.toEqual({ status: 'COMPLETED', version: 1 });

      const withExpenseLinks = await prisma.payrollObligationExpense.findMany({
        where: {
          organizationId: orgId,
          obligationId: withExpense.obligation.id,
        },
      });
      expect(withExpenseLinks).toHaveLength(1);
      const linkedExpense = await prisma.expense.findUniqueOrThrow({
        where: { id: withExpenseLinks[0].expenseId },
        include: { payments: { orderBy: { date: 'asc' } } },
      });
      expect(linkedExpense.total.toFixed(2)).toBe(GROUPED_TOTAL);
      // One payment for the referenced cash on its real date and one for the new
      // installment: no third cash movement was invented for the referenced money.
      expect(linkedExpense.payments).toHaveLength(2);
      expect(
        linkedExpense.payments.map((payment) => payment.amount.toFixed(2)),
      ).toEqual([REPLACEMENT_FIRST_TOTAL, REPLACEMENT_SECOND_TOTAL]);
      expect(
        linkedExpense.payments.map((payment) =>
          payment.date.toISOString().slice(0, 10),
        ),
      ).toEqual([
        DATE_REPLACEMENT_SOURCE,
        DATE_REPLACEMENT_COMPLETE_WITH_EXPENSE,
      ]);
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBefore + 1);

      // Disabled choice: the same kind of completion writes no expense at all.
      const completionWithoutExpense = await periodInstallments.create(
        {
          employeeId: employeeReplacementCompleteId,
          obligationId: withoutExpense.obligation.id,
          amount: REPLACEMENT_FIRST_TOTAL,
          date: DATE_REPLACEMENT_COMPLETE_WITHOUT_EXPENSE,
          method: PaymentMethod.CASH,
        },
        orgId,
        actor,
      );
      expect(completionWithoutExpense.status).toBe('COMPLETED');
      await expect(
        prisma.payrollObligation.findUniqueOrThrow({
          where: { id: withoutExpense.obligation.id },
          select: { status: true, version: true },
        }),
      ).resolves.toEqual({ status: 'COMPLETED', version: 1 });
      await expect(
        prisma.payrollObligationExpense.count({
          where: {
            organizationId: orgId,
            obligationId: withoutExpense.obligation.id,
          },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.expense.count({ where: { organizationId: orgId } }),
      ).resolves.toBe(expensesBefore + 1);

      // Exactly one completion each: a further installment is refused, so the
      // completion (and its single expense) cannot happen twice.
      await expect(
        periodInstallments.create(
          {
            employeeId: employeeReplacementCompleteId,
            obligationId: withExpense.obligation.id,
            amount: '1.00',
            date: DATE_REPLACEMENT_COMPLETE_WITHOUT_EXPENSE,
            method: PaymentMethod.CASH,
          },
          orgId,
          actor,
        ),
      ).rejects.toThrow('Pago no disponible');
      await expect(
        prisma.payrollCashOutflow.count({
          where: {
            organizationId: orgId,
            employeeId: employeeReplacementCompleteId,
          },
        }),
      ).resolves.toBe(4);
    }, 60000);

    it('13. probe: two expense-writing completions of different employees in one tenant either both commit or PostgreSQL kills one on the Organization lock upgrade', async () => {
      // Both completions write an expense, and both first insert rows whose foreign
      // keys take a KEY SHARE lock on the same `Organization` row. The category
      // resolver then asks for that row FOR UPDATE, which conflicts with KEY SHARE.
      // Whether PostgreSQL deadlocks therefore depends on the interleaving, and this
      // probe asserts the observed outcome instead of assuming one.
      const completionA = {
        employeeId: employeeOrganizationProbeAId,
        obligationId: organizationProbeObligationAId,
        amount: ORGANIZATION_PROBE_TOTAL_A,
        date: DATE_ORGANIZATION_LOCK_PROBE,
        method: PaymentMethod.CASH,
      };
      const completionB = {
        employeeId: employeeOrganizationProbeBId,
        obligationId: organizationProbeObligationBId,
        amount: ORGANIZATION_PROBE_TOTAL_B,
        date: DATE_ORGANIZATION_LOCK_PROBE,
        method: PaymentMethod.CASH,
      };

      const settled = await Promise.all([
        periodInstallments.create({ ...completionA }, orgId, actor).then(
          (value) => ({ side: 'completion A', ok: true as const, value }),
          (error: unknown) => ({
            side: 'completion A',
            ok: false as const,
            error,
          }),
        ),
        periodInstallmentsSecond.create({ ...completionB }, orgId, actor).then(
          (value) => ({ side: 'completion B', ok: true as const, value }),
          (error: unknown) => ({
            side: 'completion B',
            ok: false as const,
            error,
          }),
        ),
      ]);
      const failures = settled.filter(
        (result): result is { side: string; ok: false; error: unknown } =>
          !result.ok,
      );
      const survivors = settled.filter((result) => result.ok);
      console.log(
        `[payroll-pg-int] Organization lock-upgrade probe: ${survivors.length} committed, ${failures.length} refused${failures
          .map(
            (failure) =>
              ` (${failure.side} -> ${describeDatabaseError(failure.error)})`,
          )
          .join('')}`,
      );

      if (failures.length === 0) {
        // Observed outcome 1: no upgrade cycle in this run, both payments commit.
        expect(survivors).toHaveLength(2);
        expect(settled.map((result) => result.ok)).toEqual([true, true]);
        for (const survivor of survivors) {
          expect(survivor.ok ? survivor.value.status : undefined).toBe(
            'COMPLETED',
          );
        }
      } else {
        // Observed outcome 2: PostgreSQL resolved a real cycle. Exactly one side may
        // die, and only from its own deadlock detection - never from a client-side
        // transaction budget, which would be a different (and unhandled) defect.
        expect(failures).toHaveLength(1);
        const victim = failures[0];
        expect(deadlockEvidence(victim.error)).toMatch(/40P01|deadlock/i);
        expect(deadlockEvidence(victim.error)).not.toMatch(/P2028/);

        const victimRequest =
          victim.side === 'completion A' ? completionA : completionB;
        const victimEmployeeId = victimRequest.employeeId;
        const victimObligationId = victimRequest.obligationId;
        await expect(
          prisma.payrollObligation.findUniqueOrThrow({
            where: { id: victimObligationId },
            select: { status: true, version: true },
          }),
        ).resolves.toEqual({ status: 'PENDING', version: 0 });
        await expect(
          prisma.payrollCashOutflow.count({
            where: { organizationId: orgId, employeeId: victimEmployeeId },
          }),
        ).resolves.toBe(0);
        await expect(
          prisma.payrollObligationExpense.count({
            where: { obligationId: victimObligationId },
          }),
        ).resolves.toBe(0);

        // The victim left nothing behind, so the same request commits on retry.
        const retried = await periodInstallments.create(
          { ...victimRequest },
          orgId,
          actor,
        );
        expect(retried.status).toBe('COMPLETED');
      }

      // Whatever PostgreSQL did, the committed state is consistent and each payment
      // completed exactly once with exactly one expense.
      for (const [employeeId, obligationId, total] of [
        [
          employeeOrganizationProbeAId,
          organizationProbeObligationAId,
          ORGANIZATION_PROBE_TOTAL_A,
        ],
        [
          employeeOrganizationProbeBId,
          organizationProbeObligationBId,
          ORGANIZATION_PROBE_TOTAL_B,
        ],
      ] as const) {
        await expect(
          prisma.payrollObligation.findUniqueOrThrow({
            where: { id: obligationId },
            select: { status: true, version: true },
          }),
        ).resolves.toEqual({ status: 'COMPLETED', version: 1 });
        const outflows = await prisma.payrollCashOutflow.findMany({
          where: { organizationId: orgId, employeeId },
        });
        expect(outflows).toHaveLength(1);
        expect(outflows[0].amount.toFixed(2)).toBe(total);
        const links = await prisma.payrollObligationExpense.findMany({
          where: { obligationId },
        });
        expect(links).toHaveLength(1);
        const expense = await prisma.expense.findUniqueOrThrow({
          where: { id: links[0].expenseId },
          include: { payments: true },
        });
        expect(expense.total.toFixed(2)).toBe(total);
        expect(expense.payments).toHaveLength(1);
        expect(expense.payments[0].amount.toFixed(2)).toBe(total);
      }
    }, 90000);
  },
);

/**
 * WHAT IS NOW PROVEN HERE, AND WHAT IS STILL NOT
 *
 * Proven by this file against real PostgreSQL (opt-in, see the header):
 * - concurrent completing installments, expense-write rollback, the expense guard
 *   contending on the same row lock, and cash counted once;
 * - the employee-first production order cannot cycle with itself (two real
 *   completions on one employee serialise), while an intentional reverse-order
 *   AB-BA is a real PostgreSQL deadlock: Prisma surfaces it as
 *   `PrismaClientKnownRequestError` code `P2010` with `meta.code = '40P01'` and
 *   `deadlock detected` in the message. PostgreSQL picks the victim (in the
 *   observed runs the blocked production completion), so the deadlock victim
 *   leaves no cash, no expense, no link and a still-valid obligation row, and the
 *   retry commits exactly once;
 * - a lock waiter that outlives Prisma's interactive transaction budget is NOT
 *   interrupted: the promise stays pending while the statement is blocked in
 *   PostgreSQL and only rejects (P2028, "Transaction already closed ... however N
 *   ms passed") after the statement returns. Because the bound statement of
 *   scenario 6 is the expense insert, the rollback provably discards cash,
 *   installment and expense work the transaction had already done, and the retry
 *   completes;
 * - the taxonomy-deactivation race the writer documents, for both taxonomy rows it
 *   locks: a deactivation committed between the category read and the expense write
 *   fails the completion closed (409, no expense, no link). A deactivation that is
 *   already in flight when the writer asks for its `ExpenseLabel ... FOR UPDATE`
 *   lock really waits: Prisma's transaction blocks, `pg_locks` shows the waiting
 *   statement on `ExpenseLabel`, and once the deactivation commits the writer's
 *   post-lock re-read observes it and the completion fails closed, so a committed
 *   expense bound to an inactive label is no longer reachable through this
 *   ordering. The same is proven for the parent row: a *group* deactivation in
 *   flight makes the writer wait on `ExpenseGroup` in the same lock statement that
 *   also covers the label, so the completion fails closed instead of binding an
 *   expense to a dead group. Both locks are the writer's own (`lockTaxonomyRows`);
 *   no test-only lock is involved;
 * - cross-tenant isolation of these paths between two namespaced organizations:
 *   reads never cross, and twelve reads/mutations (period installment, correction,
 *   expense read/update/addPayment/remove in both directions, and the expense
 *   writer with a foreign tenant or a foreign category identity) are refused
 *   before any row is touched, with both tenants' snapshots identical afterwards;
 * - two concurrent corrections of one grouped installment (scenario 9): the two
 *   transactions serialise on the employee row, exactly one applies, and the loser
 *   answers 409 `Pago no disponible` after re-reading the committed state, leaving
 *   no extra void, no extra application, no second revision, no cash change and no
 *   status change. The winner revised the same cash row in place (date and method
 *   kept), voided the superseded application, wrote the replacement applications,
 *   one `PayrollCashRevision` (sequence 1) and one status transition, and wrote no
 *   expense because the payment stores an explicit "no expense" choice;
 * - a grouped correction whose completion expense write fails (scenario 10, phase
 *   A) answers 409 with no void, no replacement, no revision, no cash change, no
 *   status change, no expense/payment/audit row, and the same correction commits
 *   afterwards. In this writer the expense is written *before* the money writes, so
 *   phase A proves "no partial write" rather than discarding written money; phase B
 *   supplies that proof: with the superseded application held `FOR UPDATE`, the
 *   correction blocks on its own void insert after it already wrote the expense,
 *   its payment mirror, its audit row and the obligation/expense link, the
 *   interactive transaction expires while the statement is blocked, and PostgreSQL
 *   discards all of it (P2028 -> 503), leaving the pending payment and its original
 *   75.00 cash untouched, with the retry committing the only expense of that
 *   payment;
 * - two concurrent reference-based replacements of the same source installment
 *   (scenario 11): exactly one succeeds, the other answers 409 `El abono ya fue
 *   referenciado`, and there is exactly one new pending payment, exactly one
 *   reference row, no new cash outflow and no change to the completed source
 *   (status, version, installments, voids, revisions, no expense);
 * - a replacement whose referenced cash plus its completing installment reaches
 *   COMPLETED exactly once (scenario 12): with the stored choice enabled the
 *   completion writes exactly one expense of the corrected total whose two payment
 *   mirrors are the referenced cash on its real date and the new installment on the
 *   completion date (no third cash movement for the referenced money); with the
 *   choice disabled the same kind of completion writes no expense and no link. A
 *   further installment on a completed replacement is refused, so neither the
 *   completion nor its expense can happen twice;
 * - the `Organization` KEY SHARE -> FOR UPDATE upgrade between two expense-writing
 *   completions of *different* employees in one tenant (scenario 13) is a real
 *   hazard of the production lock order, not a hypothetical one: each completion
 *   inserts rows whose foreign keys hold KEY SHARE on the tenant row before the
 *   category resolver asks for it FOR UPDATE. The suite asserts whichever outcome
 *   PostgreSQL produces in the run: either both completions commit, or exactly one
 *   dies with PostgreSQL's own deadlock (40P01) - never a P2028 - leaving no cash,
 *   expense or link, and its retry then commits. Either way each payment ends
 *   COMPLETED once with exactly one expense.
 *
 * REMAINING GAPS — assertions this suite does not, and cannot, prove:
 *
 * - Lock ordering against writers it does not exercise: the shift-date
 *   correction, the pending-installment correction, the expense taxonomy API,
 *   settings/billing organization writes. Only the two installment paths, the
 *   completion expense writer, the correction path (cross-tenant refusals only)
 *   and the expense mutation guard are traced here.
 * - No genuine AB-BA exists between the production payroll writers as written:
 *   every one of them takes the `Employee` row lock first and then only rows of
 *   that same employee, so the cycle in scenario 5 has to be built by a deliberate
 *   reverse-order transaction. A future writer that locked `Organization`, an
 *   `Expense` row or another employee's rows before the employee would create a
 *   real cycle, and this suite would not detect it.
 * - The guard and the writer scenarios take their locks through the real writer
 *   inside a test-owned transaction, not from an in-flight HTTP request: a
 *   completion can only reach those locks while its payment is still pending. The
 *   lock statements, the rows and the writers are the production ones; the
 *   surrounding request is not.
 * - No HTTP or auth layer is exercised: the tenant is the parameter these services
 *   receive, so a controller taking the tenant from the request body would not be
 *   caught here.
 * - Isolation beyond the Prisma default (READ COMMITTED), statement retries, and
 *   PostgreSQL-raised serialization failures.
 * - Reporting aggregates other than `getCashFlow` (financial overview, exports),
 *   and how a report displays a payroll outflow that a correction revised.
 * - Scenario 7 proves the label lock serializes one deactivation ordering; it does
 *   not measure the width of the remaining windows in production. The writer locks
 *   the label row only, so a concurrent **group** deactivation is still observed by
 *   a post-lock read rather than by a lock, and the `Expense` insert's own implicit
 *   key-share wait is not traced here.
 * - Scenario 13 reports the outcome of one interleaving, not the probability of it.
 *   It does not prove that the upgrade cycle is unreachable, and it does not map
 *   the deadlock to an HTTP response: only P2028 is translated by
 *   `throwPayrollTransactionError`, so an aborted side would answer 500 (L336).
 * - Scenario 9's loser is refused because the winning correction completed the
 *   payment, which is what makes "exactly one wins" observable. Two concurrent
 *   corrections with *different* non-completing amounts are not rejected by this
 *   writer: the employee lock serialises them and both apply in sequence, each with
 *   its own revision. That sequential behaviour is not asserted here.
 * - Scenario 10 phase B proves rollback of already-written money only for the
 *   grouped correction's own write order; it is not a general proof for the other
 *   payroll writers, whose blocked statements differ.
 * - No `PayrollCashReturn`, refund route, grouped-shift-date correction or copy of a
 *   completed payment beyond reference-based replacement is exercised, and the
 *   reference writer's own rollback (its only writes are the new obligation and its
 *   references) is not forced to fail here.
 */
