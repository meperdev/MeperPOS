/**
 * S5.1 — expense rows store calendar days, so the report period has to compare
 * them as calendar days.
 *
 * `Expense.date` and `ExpensePayment.date` are DateTime columns fed from
 * date-only inputs (`new Date('YYYY-MM-DD')`), which PostgreSQL stores as UTC
 * midnight. The Bogotá timestamp window used for real instants can never match
 * that shape: it starts at 05:00 UTC of the first day (dropping the whole first
 * requested day) and ends at 04:59:59.999 UTC of the day after the last one
 * (pulling in that extra day).
 *
 * These are integration tests: the services run their real Prisma queries
 * against the migrated database, so the assertions are about the money the
 * reports return, never about the shape of a where clause.
 */
import { ConfigService } from '@nestjs/config';
import {
  parseBogotaEndOfDay,
  parseBogotaStartOfDay,
} from '../common/utils/bogota-date';
import { CacheService } from '../common/services/cache.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ReportsService } from './reports.service';
import {
  setupTwoOrgFixture,
  type TwoOrgFixture,
} from '../testing/two-org-fixture';

const AUGUST = { startDate: '2026-08-01', endDate: '2026-08-31' };

describe('Report periods compare expense calendar days (S5.1)', () => {
  let fixture: TwoOrgFixture;
  let orgId: string;
  let userId: string;
  let expensesService: ExpensesService;
  let wiredReports: ReportsService;
  let fallbackReports: ReportsService;

  beforeAll(async () => {
    fixture = await setupTwoOrgFixture('reports-expense-dates');
    orgId = fixture.orgAId;
    userId = fixture.userAId;

    const group = await fixture.prisma.expenseGroup.create({
      data: { name: 'S5.1 group', organizationId: orgId },
    });
    const label = await fixture.prisma.expenseLabel.create({
      data: { name: 'S5.1 label', organizationId: orgId, groupId: group.id },
    });

    // Date-only rows land on UTC midnight, whichever day of the period they are.
    // The mid-day row keeps the previous behaviour: a row that still carries a
    // time of day on a period day keeps matching.
    const [firstDay, lastDay, midDayFirstDay, dayAfterRange] =
      await Promise.all([
        fixture.prisma.expense.create({
          data: {
            organizationId: orgId,
            labelId: label.id,
            date: new Date('2026-08-01T00:00:00.000Z'),
            total: 100,
            status: 'PAID',
            createdById: userId,
          },
        }),
        fixture.prisma.expense.create({
          data: {
            organizationId: orgId,
            labelId: label.id,
            date: new Date('2026-08-31T00:00:00.000Z'),
            total: 20,
            status: 'PAID',
            createdById: userId,
          },
        }),
        fixture.prisma.expense.create({
          data: {
            organizationId: orgId,
            labelId: label.id,
            date: new Date('2026-08-01T15:00:00.000Z'),
            total: 7,
            status: 'PAID',
            createdById: userId,
          },
        }),
        fixture.prisma.expense.create({
          data: {
            organizationId: orgId,
            labelId: label.id,
            date: new Date('2026-09-01T00:00:00.000Z'),
            total: 1000,
            status: 'PAID',
            createdById: userId,
          },
        }),
      ]);

    await fixture.prisma.expensePayment.createMany({
      data: [
        {
          expenseId: firstDay.id,
          organizationId: orgId,
          amount: 40,
          method: 'CASH',
          date: new Date('2026-08-01T00:00:00.000Z'),
        },
        {
          expenseId: lastDay.id,
          organizationId: orgId,
          amount: 10,
          method: 'TRANSFER',
          date: new Date('2026-08-31T00:00:00.000Z'),
        },
        {
          expenseId: midDayFirstDay.id,
          organizationId: orgId,
          amount: 7,
          method: 'CASH',
          date: new Date('2026-08-01T15:00:00.000Z'),
        },
        {
          expenseId: dayAfterRange.id,
          organizationId: orgId,
          amount: 500,
          method: 'CARD',
          date: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    });

    expensesService = new ExpensesService(
      fixture.prisma as never,
      new CloudinaryService(new ConfigService()),
    );
    wiredReports = new ReportsService(
      fixture.prisma as never,
      new CacheService(),
      expensesService,
    );
    // The report has a fallback used when no ExpensesService is injected; it
    // reads the same rows and must land on the same days.
    fallbackReports = new ReportsService(
      fixture.prisma as never,
      new CacheService(),
    );
  }, 30000);

  afterAll(async () => {
    const prisma = fixture.prisma;
    await prisma.expensePayment.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.expense.deleteMany({ where: { organizationId: orgId } });
    await prisma.expenseLabel.deleteMany({ where: { organizationId: orgId } });
    await prisma.expenseGroup.deleteMany({ where: { organizationId: orgId } });
    await fixture.teardown();
  });

  it('keeps the first and last requested day of expenses and drops the day after the range', async () => {
    const rows = await expensesService.findForReports(
      orgId,
      parseBogotaStartOfDay(AUGUST.startDate)!,
      parseBogotaEndOfDay(AUGUST.endDate)!,
    );

    expect(rows.map((row) => Number(row.total)).sort((a, b) => a - b)).toEqual([
      7, 20, 100,
    ]);
  });

  it('counts the first and last day of expenses as operating expenses for the period', async () => {
    const report = await wiredReports.getFinancialOverview(
      orgId,
      AUGUST.startDate,
      AUGUST.endDate,
    );

    expect(report.current.operatingExpenses).toBe('127.00');
  });

  it('counts the same expense days when the report reads expenses without ExpensesService', async () => {
    const report = await fallbackReports.getFinancialOverview(
      orgId,
      AUGUST.startDate,
      AUGUST.endDate,
    );

    expect(report.current.operatingExpenses).toBe('127.00');
  });

  it('counts expense payments by their own calendar day in the cash flow', async () => {
    const cash = await wiredReports.getCashFlow(
      orgId,
      AUGUST.startDate,
      AUGUST.endDate,
    );

    expect(cash.expensePayments.total).toBe('57.00');
    // The aggregate reads rows without an ORDER BY, so the group order is not a
    // contract: compare the money by method.
    expect(
      [...cash.expensePayments.byPaymentMethod].sort((a, b) =>
        a.paymentMethod.localeCompare(b.paymentMethod),
      ),
    ).toEqual([
      { paymentMethod: 'CASH', total: '47.00', count: 2 },
      { paymentMethod: 'TRANSFER', total: '10.00', count: 1 },
    ]);
  });

  it('exports the same expense days through the economic export', async () => {
    const exported = await wiredReports.getEconomicExport(
      orgId,
      AUGUST.startDate,
      AUGUST.endDate,
    );

    expect(exported.financial.current.operatingExpenses).toBe('127.00');
    expect(exported.cash.expensePayments.total).toBe('57.00');
  });
});
