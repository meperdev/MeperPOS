import { formatDateInBogota } from '../common/utils/bogota-date';
import { ExpensesService } from './expenses.service';
import {
  setupTwoOrgFixture,
  type TwoOrgFixture,
} from '../testing/two-org-fixture';

const cloudinaryServiceMock = {
  uploadImage: jest.fn(),
  deleteImage: jest.fn(),
};

describe('ExpensesService — Integration (Isolation + Payments + Summary)', () => {
  let prisma: TwoOrgFixture['prisma'];
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let service: ExpensesService;
  let fixture: TwoOrgFixture;
  let labelArriendoId: string;
  let labelCajaMenorId: string;
  let labelOrgBId: string;

  const buildCreateDto = (
    labelId: string,
    overrides: Partial<{
      date: string | Date;
      total: number;
      payments: {
        amount: number;
        method: 'CASH' | 'CARD' | 'TRANSFER';
        date: string;
      }[];
      description: string;
    }> = {},
  ) => ({
    labelId,
    description: overrides.description ?? 'Gasto de integración',
    date: (overrides.date ?? '2026-08-15') as string,
    total: overrides.total ?? 500000,
    payments: overrides.payments ?? [
      {
        amount: overrides.total ?? 500000,
        method: 'CASH' as const,
        date: '2026-08-15',
      },
    ],
  });

  beforeAll(async () => {
    fixture = await setupTwoOrgFixture('expenses-int');
    prisma = fixture.prisma;
    orgAId = fixture.orgAId;
    orgBId = fixture.orgBId;
    userAId = fixture.userAId;
    userBId = fixture.userBId;

    service = new ExpensesService(
      prisma as never,
      cloudinaryServiceMock as never,
    );

    const [groupA, groupB] = await Promise.all([
      prisma.expenseGroup.create({
        data: { name: 'Integration A', organizationId: orgAId },
      }),
      prisma.expenseGroup.create({
        data: { name: 'Integration B', organizationId: orgBId },
      }),
    ]);
    const [labelArriendo, labelCajaMenor, labelOrgB] = await Promise.all([
      prisma.expenseLabel.create({
        data: {
          name: 'Arriendo INT',
          organizationId: orgAId,
          groupId: groupA.id,
        },
      }),
      prisma.expenseLabel.create({
        data: {
          name: 'Caja menor INT',
          organizationId: orgAId,
          groupId: groupA.id,
        },
      }),
      prisma.expenseLabel.create({
        data: {
          name: 'Categoría org B',
          organizationId: orgBId,
          groupId: groupB.id,
        },
      }),
    ]);
    labelArriendoId = labelArriendo.id;
    labelCajaMenorId = labelCajaMenor.id;
    labelOrgBId = labelOrgB.id;
  });

  afterAll(() =>
    fixture.teardown(async () => {
      await prisma.expensePayment.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } },
      });
      await prisma.auditLog.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } },
      });
      await prisma.expense.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } },
      });
      await prisma.expenseLabel.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } },
      });
    }),
  );

  it('isolates organizations: cross-org reads 404 and lists never leak', async () => {
    const created = await service.create(
      buildCreateDto(labelArriendoId),
      userAId,
      orgAId,
    );

    await expect(service.findOne(created.id, orgBId)).rejects.toThrow(
      'Salida no encontrada',
    );
    await expect(service.getHistory(created.id, orgBId)).rejects.toThrow(
      'Salida no encontrada',
    );
    await expect(
      service.duplicate(created.id, userBId, orgBId),
    ).rejects.toThrow('Salida no encontrada');

    const listB = await service.findAll({}, orgBId);
    expect(listB.data).toHaveLength(0);
    expect(listB.meta.total).toBe(0);

    const summaryB = await service.getMonthlySummary('2026-08', orgBId);
    expect(summaryB.total.toString()).toBe('0');
  });

  it('supports the partial to paid payment flow and rejects overpayment', async () => {
    const created = await service.create(
      buildCreateDto(labelArriendoId, {
        total: 500000,
        payments: [{ amount: 200000, method: 'TRANSFER', date: '2026-08-15' }],
      }),
      userAId,
      orgAId,
    );
    expect(created.status).toBe('PARTIAL');

    const paid = await service.addPayment(
      created.id,
      { amount: 300000, method: 'CASH', date: '2026-08-16' },
      userAId,
      orgAId,
    );
    expect(paid.status).toBe('PAID');

    await expect(
      service.addPayment(
        created.id,
        { amount: 1, method: 'CASH', date: '2026-08-17' },
        userAId,
        orgAId,
      ),
    ).rejects.toThrow(
      'La suma de los pagos no puede superar el total de la salida',
    );

    const history = await service.getHistory(created.id, orgAId);
    expect(history.map((entry) => entry.action)).toEqual([
      'EXPENSE_CREATED',
      'EXPENSE_PAYMENT_ADDED',
    ]);
  });

  it('summarizes the Bogota month per category, honoring month boundaries and org scope', async () => {
    await service.create(
      buildCreateDto(labelArriendoId, {
        description: 'Arriendo junio',
        date: '2026-06-15',
        total: 500000,
        payments: [{ amount: 500000, method: 'CASH', date: '2026-06-15' }],
      }),
      userAId,
      orgAId,
    );
    await service.create(
      buildCreateDto(labelArriendoId, {
        description: 'Inicio de mes (00:00 Bogota)',
        date: new Date('2026-06-01T05:00:00.000Z'),
        total: 200000,
        payments: [
          { amount: 200000, method: 'CASH', date: '2026-06-01T05:00:00.000Z' },
        ],
      }),
      userAId,
      orgAId,
    );
    await service.create(
      buildCreateDto(labelCajaMenorId, {
        description: 'Caja menor junio',
        date: '2026-06-20',
        total: 300000,
        payments: [{ amount: 300000, method: 'CASH', date: '2026-06-20' }],
      }),
      userAId,
      orgAId,
    );
    await service.create(
      buildCreateDto(labelArriendoId, {
        description: '31 de mayo — fuera del mes',
        date: new Date('2026-05-31T12:00:00.000Z'),
        total: 999999,
        payments: [
          {
            amount: 999999,
            method: 'CASH',
            date: '2026-05-31T12:00:00.000Z',
          },
        ],
      }),
      userAId,
      orgAId,
    );
    await service.create(
      buildCreateDto(labelOrgBId, {
        description: 'Gasto de la organización B',
        date: '2026-06-18',
        total: 777777,
        payments: [{ amount: 777777, method: 'CASH', date: '2026-06-18' }],
      }),
      userBId,
      orgBId,
    );

    const summary = await service.getMonthlySummary('2026-06', orgAId);

    expect(summary.month).toBe('2026-06');
    expect(summary.total.toString()).toBe('1000000');
    expect(
      summary.groups.flatMap((group) =>
        group.labels.map((row) => ({
          labelId: row.labelId,
          name: row.name,
          total: row.total.toString(),
        })),
      ),
    ).toEqual([
      { labelId: labelArriendoId, name: 'Arriendo INT', total: '700000' },
      { labelId: labelCajaMenorId, name: 'Caja menor INT', total: '300000' },
    ]);
  });

  it('counts the first and the last stored day of a month, and not the next month first day', async () => {
    // `Expense.date` carries a calendar day, not an instant: the API writes
    // `new Date('YYYY-MM-DD')` at UTC midnight and the payroll writer writes the
    // same day at 05:00 UTC, so both shapes sit inside the stored day and the
    // month window has to be built from stored days.
    for (const [date, total] of [
      ['2026-04-01', 100000],
      ['2026-04-30', 200000],
      ['2026-05-01', 300000],
    ] as const) {
      await service.create(
        buildCreateDto(labelArriendoId, {
          description: `Gasto del ${date}`,
          date,
          total,
          payments: [{ amount: total, method: 'CASH', date }],
        }),
        userAId,
        orgAId,
      );
    }

    const summary = await service.getMonthlySummary('2026-04', orgAId);

    expect(summary.month).toBe('2026-04');
    expect(summary.total.toString()).toBe('300000');
  });

  it('duplicates an expense with today Bogota date, copied payments and derived status', async () => {
    const created = await service.create(
      buildCreateDto(labelArriendoId, {
        description: 'Original a duplicar',
        date: '2026-08-10',
        total: 500000,
        payments: [
          { amount: 300000, method: 'CASH', date: '2026-08-10' },
          { amount: 200000, method: 'TRANSFER', date: '2026-08-11' },
        ],
      }),
      userAId,
      orgAId,
    );
    expect(created.status).toBe('PAID');

    const duplicated = await service.duplicate(created.id, userAId, orgAId);

    expect(duplicated.id).not.toBe(created.id);
    expect(duplicated.labelId).toBe(labelArriendoId);
    expect(duplicated.description).toBe('Original a duplicar');
    expect(duplicated.total.toString()).toBe('500000');
    expect(duplicated.status).toBe('PAID');
    expect(duplicated.date.toISOString()).toBe(
      new Date(formatDateInBogota(new Date())).toISOString(),
    );
    expect(duplicated.payments).toHaveLength(2);
    expect(duplicated.payments.map((payment) => payment.method)).toEqual([
      'CASH',
      'TRANSFER',
    ]);

    const history = await service.getHistory(duplicated.id, orgAId);
    expect(history.map((entry) => entry.action)).toEqual([
      'EXPENSE_DUPLICATED',
    ]);
  });
});
