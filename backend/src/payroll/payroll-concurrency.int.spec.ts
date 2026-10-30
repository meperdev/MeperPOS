import { ConflictException } from '@nestjs/common';
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
import { PayrollGroupInstallmentsService } from './payroll-group-installments.service';
import { PayrollGroupsService } from './payroll-groups.service';
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
 *    mirrored `ExpensePayment`.
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
 * What this file still cannot prove is listed at the bottom of the spec
 * (`REMAINING GAPS`) and repeated in the handoff.
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

    let labelId: string;
    let controlLabelId: string;

    let concurrentObligationId: string;
    let rollbackObligationId: string;
    let cashFlowObligationId: string;

    let concurrentExpenseId: string;
    let concurrentOutflowId: string;

    let periodInstallments: PayrollPeriodInstallmentsService;
    let periodInstallmentsSecond: PayrollPeriodInstallmentsService;
    let groupInstallments: PayrollGroupInstallmentsService;
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
      expenses = new ExpensesService(prisma, {} as never);
      reports = new ReportsService(prisma, new CacheService());

      console.log(
        `[payroll-pg-int] fixtures created: org=${organization.id} slug=${runId} employees=3 obligations=3 shifts=2`,
      );
    }, 60000);

    afterAll(async () => {
      const createdOrgId = orgId;
      const createdUserId = userId;
      let afterCounts: Record<string, number> | undefined;
      let cleanupError: Error | undefined;

      try {
        if (createdOrgId) {
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
            },
            { timeout: 30000, maxWait: 30000 },
          );

          // Outside replica mode: the user and the tenant go through their normal
          // constraints, so a missed child row fails loudly instead of being hidden.
          if (createdUserId)
            await prisma.user.deleteMany({ where: { id: createdUserId } });
          await prisma.organization.deleteMany({ where: { id: createdOrgId } });

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
            throw new Error(
              `Fixture cleanup left rows behind: outflows=${remaining} links=${remainingLinks} expenses=${remainingExpenses} organizations=${remainingOrg}`,
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
            `[payroll-pg-int] fixtures removed for org=${createdOrgId}: outflows=0 links=0 expenses=0 organizations=0`,
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
  },
);

/**
 * REMAINING GAPS — assertions this suite does not, and cannot, prove:
 *
 * - Lock ordering against writers it does not exercise: the shift-date
 *   correction, the pending-installment correction, the expense taxonomy API,
 *   settings/billing organization writes. Only the two installment paths, the
 *   completion expense writer and the expense mutation guard are traced here.
 * - The guard scenario holds the completion's row lock from the real writer's
 *   replay verification inside a test-owned transaction, not from an in-flight
 *   completion request: a completion can only reach that lock while its payment is
 *   still pending, and a completed payment cannot be completed again. The lock
 *   statement, the row and the writer are the production ones; the surrounding
 *   request is not.
 * - Deadlock detection: a genuine AB-BA cycle is not constructed, so PostgreSQL
 *   deadlock (40P01) and Prisma P2028 lock-wait classification remain unproven.
 * - Isolation beyond the Prisma default (READ COMMITTED) and any retry semantics.
 * - The taxonomy deactivation race the writer's own comment admits (a deactivation
 *   committing between the category read and the expense write) is not forced.
 * - Cross-tenant isolation of these paths: the fixtures are single-tenant.
 * - Reporting aggregates other than `getCashFlow` (financial overview, exports).
 */
