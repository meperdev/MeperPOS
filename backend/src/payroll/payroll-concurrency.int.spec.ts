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
import { PayrollGroupInstallmentsService } from './payroll-group-installments.service';
import { PayrollGroupsService } from './payroll-groups.service';
import type { PayrollObligationCompletionFacts } from './payroll-obligation-completion';
import { PayrollObligationsService } from './payroll-obligations.service';
import { PayrollPeriodInstallmentCorrectionService } from './payroll-period-installment-correction.service';
import { PayrollPeriodInstallmentsService } from './payroll-period-installments.service';
import { PayrollPeriodsService } from './payroll-periods.service';

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
 * 7. the taxonomy-deactivation race the writer documents: a deactivation
 *    committed between the category read and the expense write fails the
 *    completion closed, and a deactivation that is already in flight when the
 *    writer takes its `ExpenseLabel ... FOR UPDATE` lock serializes with it, so
 *    the completion fails closed instead of committing an expense bound to an
 *    inactive label;
 * 8. cross-tenant isolation between two namespaced fixture organizations for
 *    the obligation, installment, cash and expense rows these paths own.
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
 *   triggers. Foreign keys still fire, so the delete order is the real one;
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
const ISOLATION_TOTAL_A = '60.00';
const ISOLATION_TOTAL_B_PENDING = '100.00';
const ISOLATION_PAID_B = '40.00';
const ISOLATION_TOTAL_B_COMPLETED = '50.00';
// The writer never validates the ids inside the facts it is handed (a documented
// precondition), so these two opaque placeholders identify the test-owned facts
// of scenario 7. They are never persisted as a `PayrollCashOutflow`.
const TEST_OWNED_OUTFLOW_A = 'test-owned-outflow-taxonomy-before-write';
const TEST_OWNED_OUTFLOW_B = 'test-owned-outflow-taxonomy-after-write';

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

    let periodInstallments: PayrollPeriodInstallmentsService;
    let periodInstallmentsSecond: PayrollPeriodInstallmentsService;
    let groupInstallments: PayrollGroupInstallmentsService;
    let correction: PayrollPeriodInstallmentCorrectionService;
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
              // BEFORE triggers. Replica mode disables exactly those user triggers
              // for this transaction; foreign-key triggers still fire, so the
              // delete order below is the real dependency order. The preflight
              // check guarantees the role may do this.
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
            const remainingExpenses = await prisma.expense.count({
              where: { organizationId: createdOrgId },
            });
            const remainingOrg = await prisma.organization.count({
              where: { id: createdOrgId },
            });
            if (
              remaining !== 0 ||
              remainingLinks !== 0 ||
              remainingExpenses !== 0 ||
              remainingOrg !== 0
            )
              leftovers.push(
                `org=${createdOrgId} outflows=${remaining} links=${remainingLinks} expenses=${remainingExpenses} organizations=${remainingOrg}`,
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
            `[payroll-pg-int] fixtures removed for ${createdOrgIds.length} organizations: outflows=0 links=0 expenses=0 organizations=0`,
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
      // The real code, and the proof that it is the transaction being closed
      // after the deadline rather than an interrupted statement.
      expect(deadlockEvidence(interruptedResult.error)).toMatch(/P2028/);
      expect(deadlockEvidence(interruptedResult.error)).toMatch(
        /however \d+ ms passed since the start of the transaction/,
      );

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

    it('7. taxonomy deactivation race: forced between the category read and the expense write, and forced to compete for the writer label lock', async () => {
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
    }, 60000);

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
 * - the taxonomy-deactivation race the writer documents: a deactivation committed
 *   between the category read and the expense write fails the completion closed
 *   (409, no expense, no link). A deactivation that is already in flight when the
 *   writer asks for its `ExpenseLabel ... FOR UPDATE` lock really waits: Prisma's
 *   transaction blocks, `pg_locks` shows the waiting statement on `ExpenseLabel`,
 *   and once the deactivation commits the writer's post-lock re-read observes it
 *   and the completion fails closed, so a committed expense bound to an inactive
 *   label is no longer reachable through this ordering. The lock is the writer's
 *   own (`lockCategoryLabel`); no test-only lock is involved;
 * - cross-tenant isolation of these paths between two namespaced organizations:
 *   reads never cross, and twelve reads/mutations (period installment, correction,
 *   expense read/update/addPayment/remove in both directions, and the expense
 *   writer with a foreign tenant or a foreign category identity) are refused
 *   before any row is touched, with both tenants' snapshots identical afterwards.
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
 */
