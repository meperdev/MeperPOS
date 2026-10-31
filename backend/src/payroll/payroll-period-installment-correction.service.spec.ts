import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { PayrollPeriodInstallmentCorrectionService } from './payroll-period-installment-correction.service';

const actor = {
  userId: 'u',
  organizationId: 'org',
  role: 'OWNER',
} as RequestUser;
const input = {
  employeeId: 'emp',
  obligationId: 'period',
  installmentId: 'inst',
  amount: '40.00',
};
const date = new Date('2024-02-29T00:00:00.000Z');

function setup() {
  const installment = {
    id: 'inst',
    organizationId: 'org',
    employeeId: 'emp',
    obligationId: 'period',
    outflowId: 'cash',
    _count: { allocations: 0 },
    outflow: {
      id: 'cash',
      organizationId: 'org',
      employeeId: 'emp',
      amount: new Prisma.Decimal('30'),
      date,
      method: 'CASH',
      _count: { installments: 1 },
    },
    revisions: [] as Array<{
      sequence?: number;
      oldAmount: Prisma.Decimal;
      newAmount: Prisma.Decimal;
      originalDate: Date;
      originalMethod: string;
      createdAt: Date;
    }>,
  };
  const period = {
    id: 'period',
    organizationId: 'org',
    employeeId: 'emp',
    kind: 'FIXED_PERIOD',
    status: 'PENDING',
    version: 7,
    periodAmount: new Prisma.Decimal('100'),
    // Null is the unspecified stored choice, never "disabled".
    expenseEnabled: null as boolean | null,
    selectedExpenseDate: null as Date | null,
    installments: [installment],
  };
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'period' }])
      .mockResolvedValueOnce([{ id: 'cash' }])
      // Fourth lookup is the Organization lock of the category resolution.
      .mockResolvedValue([{ id: 'org' }]),
    payrollObligation: {
      findFirst: jest.fn().mockResolvedValue(period),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payrollInstallment: {
      findFirst: jest.fn().mockResolvedValue(installment),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    payrollCashOutflow: {
      findFirst: jest.fn().mockResolvedValue(installment.outflow),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    payrollCashRevision: {
      findMany: jest.fn().mockImplementation(async () => installment.revisions),
      create: jest.fn().mockResolvedValue({ id: 'revision' }),
      update: jest.fn(),
      delete: jest.fn(),
    },
    // Completion expense seam of the wired period-installments path.
    payrollExpenseCategory: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ labelId: 'lbl', groupId: 'grp' }),
    },
    expenseGroup: {
      findUnique: jest.fn().mockResolvedValue({ id: 'grp', active: true }),
    },
    expenseLabel: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'lbl',
        groupId: 'grp',
        active: true,
        group: { active: true },
      }),
    },
    payrollObligationExpense: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    expense: { create: jest.fn().mockResolvedValue({ id: 'expense' }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
    payment: { create: jest.fn() },
  };
  const transaction = jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
    fn(tx),
  );
  return {
    tx,
    period,
    installment,
    transaction,
    service: new PayrollPeriodInstallmentCorrectionService({
      $transaction: transaction,
    } as unknown as PrismaService),
  };
}

function noWrites(tx: ReturnType<typeof setup>['tx']) {
  expect(tx.payrollCashOutflow.updateMany).not.toHaveBeenCalled();
  expect(tx.payrollCashOutflow.update).not.toHaveBeenCalled();
  expect(tx.payrollCashRevision.create).not.toHaveBeenCalled();
  expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
  expect(tx.expense.create).not.toHaveBeenCalled();
  expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
}

// The correction day is derived from the clock, so the completion-day tests pin it.
function at(instant: string) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(instant));
}

describe('pending fixed-period cash correction (mock transactions only)', () => {
  it('maps a transaction timeout to a retryable service error', async () => {
    const { service, transaction } = setup();
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('transaction expired', {
        code: 'P2028',
        clientVersion: 'test',
      }),
    );
    await expect(service.correct(input, 'org', actor)).rejects.toMatchObject({
      status: 503,
      message:
        'No se pudo confirmar la operación. Verifique su estado antes de reintentar',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['OWNER', 'ADMIN'])(
    'revises undelivered cash in place with immutable evidence for %s',
    async (role) => {
      const { service, tx, transaction } = setup();
      await service.correct(input, 'org', { ...actor, role } as RequestUser);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
      for (const [index, table] of [
        'Employee',
        'PayrollObligation',
        'PayrollCashOutflow',
      ].entries()) {
        expect(tx.$queryRaw.mock.calls[index][0].join('?')).toMatch(
          new RegExp(`FROM "${table}"[\\s\\S]*FOR UPDATE`),
        );
      }
      expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['emp', 'org']);
      expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([
        'period',
        'org',
        'emp',
      ]);
      expect(tx.$queryRaw.mock.calls[2].slice(1)).toEqual([
        'cash',
        'org',
        'emp',
      ]);
      expect(tx.payrollCashOutflow.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'cash',
          organizationId: 'org',
          employeeId: 'emp',
        }),
        data: { amount: new Prisma.Decimal('40') },
      });
      expect(tx.payrollCashRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org',
          employeeId: 'emp',
          obligationId: 'period',
          installmentId: 'inst',
          outflowId: 'cash',
          actorId: 'u',
          sequence: 1,
          oldAmount: new Prisma.Decimal('30'),
          newAmount: new Prisma.Decimal('40'),
          originalDate: date,
          originalMethod: 'CASH',
        }),
      });
      expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'period',
          organizationId: 'org',
          employeeId: 'emp',
          status: 'PENDING',
          version: 7,
        }),
        data: expect.objectContaining({ version: { increment: 1 } }),
      });
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
      expect(tx.payrollCashOutflow.delete).not.toHaveBeenCalled();
      expect(tx.payrollInstallment.create).not.toHaveBeenCalled();
      expect(tx.payrollInstallment.update).not.toHaveBeenCalled();
      expect(tx.payrollInstallment.delete).not.toHaveBeenCalled();
      expect(tx.payrollCashRevision.update).not.toHaveBeenCalled();
      expect(tx.payrollCashRevision.delete).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    { ...actor, role: 'MEMBER' },
    { ...actor, organizationId: 'other' },
    { ...actor, userId: '' },
  ])(
    'rejects unauthorized or cross-tenant actor before transaction',
    async (who) => {
      const { service, transaction } = setup();
      await expect(
        service.correct(input, 'org', who as RequestUser | undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects a missing tenant before transaction', async () => {
    const { service, transaction } = setup();
    await expect(
      service.correct(input, undefined, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '0.001', '1e2', '1'.repeat(131073)])(
    'rejects invalid correction amount before transaction',
    async (amount) => {
      const { service, transaction } = setup();
      await expect(
        service.correct({ ...input, amount }, 'org', actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['COMPLETED', 'SHIFT_GROUP'])(
    'rejects unavailable period %s',
    async (value) => {
      const { service, tx, period } = setup();
      if (value === 'COMPLETED') period.status = value;
      else period.kind = value;
      await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      noWrites(tx);
    },
  );
  it('does not cross an employee tenant lock boundary', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockReset().mockResolvedValueOnce([]);
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    noWrites(tx);
  });
  it('rejects allocations attached to a fixed-period installment without writes', async () => {
    const { service, tx, installment } = setup();
    installment._count.allocations = 1;
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });
  it('rejects a shared outflow without writes', async () => {
    const { service, tx, installment } = setup();
    installment.outflow._count.installments = 2;
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });
  it('rejects a correction above the balance', async () => {
    const { service, tx } = setup();
    await expect(
      service.correct({ ...input, amount: '100.01' }, 'org', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    noWrites(tx);
    expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
  });

  // S4: "Completarlo y aplicar la opción de gasto". A corrected pending
  // installment that reaches the exact outstanding total completes the payment and
  // applies the obligation's stored expense choice inside this transaction. Mocks
  // prove requested order and effects only: they cannot prove rollback or locks.
  describe('exact completion', () => {
    it('completes the payment and applies the expense choice', async () => {
      const { service, tx, period, transaction } = setup();
      period.expenseEnabled = true;
      // Same Bogotá day as the outflow, so the fixture keeps one expected date.
      at('2024-02-29T15:00:00.000Z');

      await expect(
        service.correct({ ...input, amount: '100' }, 'org', actor),
      ).resolves.toMatchObject({
        paid: '100.00',
        balance: '0.00',
        status: 'COMPLETED',
      });

      // Revision evidence is still appended for the corrected cash row.
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(tx.payrollCashOutflow.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'cash',
          organizationId: 'org',
          employeeId: 'emp',
        }),
        data: { amount: new Prisma.Decimal('100') },
      });
      expect(tx.payrollCashRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org',
          employeeId: 'emp',
          obligationId: 'period',
          installmentId: 'inst',
          outflowId: 'cash',
          actorId: 'u',
          sequence: 1,
          oldAmount: new Prisma.Decimal('30'),
          newAmount: new Prisma.Decimal('100'),
          originalDate: date,
          originalMethod: 'CASH',
        }),
      });

      // The category is resolved inside this transaction, after the three payroll
      // locks, so the expense shares the completion's fate.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(5);
      expect(tx.$queryRaw.mock.calls[3][0].join('?')).toMatch(
        /FROM "Organization"[\s\S]*FOR UPDATE/,
      );
      expect(tx.$queryRaw.mock.calls[4][0].join('?')).toMatch(
        /FROM "ExpenseLabel"[\s\S]*JOIN "ExpenseGroup"[\s\S]*FOR UPDATE OF g, l/,
      );
      expect(tx.$queryRaw.mock.calls[3].slice(1)).toEqual(['org']);
      expect(tx.payrollExpenseCategory.findUnique).toHaveBeenCalledWith({
        where: { organizationId: 'org' },
      });
      expect(tx.expense.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org',
          labelId: 'lbl',
          description: null,
          date: new Date('2024-02-29T05:00:00.000Z'),
          total: new Prisma.Decimal('100.00'),
          status: 'PAID',
          createdById: 'u',
          payments: {
            create: [
              {
                organizationId: 'org',
                amount: new Prisma.Decimal('100.00'),
                method: 'CASH',
                date: new Date('2024-02-29T05:00:00.000Z'),
              },
            ],
          },
        },
        select: { id: true },
      });
      expect(tx.payrollObligationExpense.create).toHaveBeenCalledWith({
        data: {
          obligationId: 'period',
          organizationId: 'org',
          employeeId: 'emp',
          expenseId: 'expense',
        },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u',
            organizationId: 'org',
            action: 'EXPENSE_CREATED',
            resource: 'Expense',
            resourceId: 'expense',
          }),
        }),
      );

      // The obligation status is the last effect, after the expense it belongs to.
      expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'period',
          organizationId: 'org',
          employeeId: 'emp',
          status: 'PENDING',
          version: 7,
        }),
        data: { status: 'COMPLETED', version: { increment: 1 } },
      });
      // Completing by correction never moves the cash date: only the amount is
      // revised, and the compare-and-swap still guards the original date.
      expect(tx.payrollCashOutflow.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'cash', date }),
        data: { amount: new Prisma.Decimal('100') },
      });
      expect(tx.expense.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.payrollObligation.updateMany.mock.invocationCallOrder[0],
      );
      // A correction never creates or removes cash rows.
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
      expect(tx.payrollCashOutflow.delete).not.toHaveBeenCalled();
    });

    it('uses the stored expense date when the payment selected one', async () => {
      const { service, tx, period } = setup();
      period.expenseEnabled = true;
      period.selectedExpenseDate = new Date('2024-03-05T00:00:00.000Z');
      // A correction made on another day must not override the stored selection.
      at('2024-03-10T15:00:00.000Z');

      await service.correct({ ...input, amount: '100' }, 'org', actor);

      const created = (
        tx.expense.create.mock.calls[0][0] as {
          data: { date: Date; payments: { create: Array<{ date: Date }> } };
        }
      ).data;
      expect(created.date).toEqual(new Date('2024-03-05T05:00:00.000Z'));
      // The stored selection changes the expense date only, never the cash date.
      expect(created.payments.create[0].date).toEqual(
        new Date('2024-02-29T05:00:00.000Z'),
      );
    });

    it('dates the expense on the Bogotá correction day when none was selected', async () => {
      const { service, tx, period } = setup();
      period.expenseEnabled = true;
      // 02:30Z on 2024-03-05 is still 2024-03-04 in Bogotá (UTC-5), so the
      // correction day differs from both the UTC day and the outflow day.
      at('2024-03-05T02:30:00.000Z');

      await expect(
        service.correct({ ...input, amount: '100' }, 'org', actor),
      ).resolves.toMatchObject({ status: 'COMPLETED' });

      const created = (
        tx.expense.create.mock.calls[0][0] as {
          data: { date: Date; payments: { create: Array<{ date: Date }> } };
        }
      ).data;
      // The expense inherits the completion day, as the Bogotá start of that day.
      expect(created.date).toEqual(new Date('2024-03-04T05:00:00.000Z'));
      // The cash outflow it mirrors keeps its own original date.
      expect(created.payments.create[0].date).toEqual(
        new Date('2024-02-29T05:00:00.000Z'),
      );
    });

    it.each([
      ['disabled', false],
      ['unknown', null],
    ])(
      'completes without an expense when the choice is %s',
      async (_case, choice) => {
        const { service, tx, period } = setup();
        period.expenseEnabled = choice;

        await expect(
          service.correct({ ...input, amount: '100' }, 'org', actor),
        ).resolves.toMatchObject({ status: 'COMPLETED' });

        expect(tx.expense.create).not.toHaveBeenCalled();
        expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
        // No category work at all: only the three payroll locks ran.
        expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
        expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
        expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { status: 'COMPLETED', version: { increment: 1 } },
          }),
        );
      },
    );

    it('sums every real outflow when a multi-installment correction completes', async () => {
      const { service, tx, period, installment } = setup();
      period.expenseEnabled = true;
      period.installments.push({
        ...installment,
        id: 'other-inst',
        outflowId: 'other-cash',
        outflow: {
          ...installment.outflow,
          id: 'other-cash',
          amount: new Prisma.Decimal('20'),
        },
        revisions: [],
      });

      await expect(
        service.correct({ ...input, amount: '80' }, 'org', actor),
      ).resolves.toMatchObject({
        paid: '100.00',
        balance: '0.00',
        status: 'COMPLETED',
      });

      // The expense describes the corrected outflow set: the revised amount and
      // the untouched cash row of the same payment.
      expect(tx.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            total: new Prisma.Decimal('100.00'),
            payments: {
              create: [
                expect.objectContaining({
                  amount: new Prisma.Decimal('80.00'),
                  method: 'CASH',
                }),
                expect.objectContaining({
                  amount: new Prisma.Decimal('20.00'),
                  method: 'CASH',
                }),
              ],
            },
          }),
        }),
      );
      // Only the corrected cash row is revised in place.
      expect(tx.payrollCashOutflow.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.payrollCashOutflow.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'cash' }),
        data: { amount: new Prisma.Decimal('80') },
      });
    });

    it('writes no expense when the corrected amount still leaves a balance', async () => {
      const { service, tx, period } = setup();
      period.expenseEnabled = true;
      at('2024-03-05T02:30:00.000Z');

      await expect(
        service.correct({ ...input, amount: '90' }, 'org', actor),
      ).resolves.toMatchObject({ status: 'PENDING' });

      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
      // A correction that does not complete revises the amount only: the cash row
      // keeps its original date, so no completion day is written anywhere.
      expect(tx.payrollCashOutflow.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'cash', date }),
        data: { amount: new Prisma.Decimal('90') },
      });
      expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: 'PENDING', version: 7 }),
        data: { status: 'PENDING', version: { increment: 1 } },
      });
      // The revision history of the partially corrected cash row is still written.
      expect(tx.payrollCashRevision.create).toHaveBeenCalledTimes(1);
    });

    it('fails closed above the expense limit', async () => {
      const { service, tx, period } = setup();
      period.expenseEnabled = true;
      period.periodAmount = new Prisma.Decimal('10000000000');

      await expect(
        service.correct({ ...input, amount: '10000000000' }, 'org', actor),
      ).rejects.toThrow(
        'El gasto de nómina supera $9.999.999.999,99; el pago no se puede completar con gasto',
      );

      // The approved limit is decided before any category or money write, so this
      // failed completion never requests the later effects. Mocks have no
      // rollback; real rollback needs PostgreSQL.
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollCashOutflow.updateMany).not.toHaveBeenCalled();
      expect(tx.payrollCashRevision.create).not.toHaveBeenCalled();
      expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
    });
  });
  it('accepts a continuous prior revision chain ending at the current amount', async () => {
    const { service, tx, installment } = setup();
    installment.revisions.push({
      sequence: 1,
      oldAmount: new Prisma.Decimal('20'),
      newAmount: new Prisma.Decimal('30'),
      originalDate: date,
      originalMethod: 'CASH',
      createdAt: new Date('2024-03-01'),
    });
    await service.correct(input, 'org', actor);
    expect(tx.payrollCashRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequence: 2,
        oldAmount: new Prisma.Decimal('30'),
        newAmount: new Prisma.Decimal('40'),
      }),
    });
  });
  it('uses the target installment sequence and includes other cash in its balance', async () => {
    const { service, tx, period, installment } = setup();
    const other = {
      ...installment,
      id: 'other-inst',
      outflowId: 'other-cash',
      outflow: {
        ...installment.outflow,
        id: 'other-cash',
        amount: new Prisma.Decimal('20'),
      },
      revisions: [],
    };
    period.installments.push(other);
    installment.revisions.push({
      sequence: 1,
      oldAmount: new Prisma.Decimal('25'),
      newAmount: new Prisma.Decimal('30'),
      originalDate: date,
      originalMethod: 'CASH',
      createdAt: new Date('2024-03-01'),
    });
    tx.payrollCashRevision.findMany.mockImplementation(async (args) =>
      args.where.installmentId === 'inst' ? installment.revisions : [],
    );
    const result = await service.correct(input, 'org', actor);
    expect(result.paid).toBe('60.00');
    expect(result.balance).toBe('40.00');
    expect(tx.payrollCashRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sequence: 2, installmentId: 'inst' }),
    });
  });
  it.each(['tail', 'link', 'date', 'method'])(
    'rejects inconsistent revision chain: %s',
    async (defect) => {
      const { service, tx, installment } = setup();
      installment.revisions.push(
        {
          sequence: 1,
          oldAmount: new Prisma.Decimal('10'),
          newAmount: new Prisma.Decimal('20'),
          originalDate: date,
          originalMethod: 'CASH',
          createdAt: new Date('2024-03-01'),
        },
        {
          sequence: 2,
          oldAmount: new Prisma.Decimal(defect === 'link' ? '21' : '20'),
          newAmount: new Prisma.Decimal(defect === 'tail' ? '29' : '30'),
          originalDate: defect === 'date' ? new Date('2024-02-28') : date,
          originalMethod: defect === 'method' ? 'CARD' : 'CASH',
          createdAt: new Date('2024-03-02'),
        },
      );
      await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      noWrites(tx);
    },
  );
  it('rejects a lost obligation version guard', async () => {
    const { service, tx } = setup();
    tx.payrollObligation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 7 }),
      }),
    );
  });
  it('rejects a lost cash compare-and-swap before appending evidence', async () => {
    const { service, tx } = setup();
    tx.payrollCashOutflow.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.payrollCashRevision.create).not.toHaveBeenCalled();
  });
  it('rejects a changed outflow identity on the post-lock reread', async () => {
    const { service, tx, period, installment } = setup();
    tx.payrollObligation.findFirst
      .mockResolvedValueOnce(period)
      .mockResolvedValueOnce({
        ...period,
        installments: [{ ...installment, outflowId: 'other' }],
      });
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });
  it.each(['2024-03-01', '2024-02-28'])(
    'orders by sequence despite same or inverted transaction timestamps: %s',
    async (secondDate) => {
      const { service, tx, installment } = setup();
      installment.revisions.push(
        {
          sequence: 1,
          oldAmount: new Prisma.Decimal('10'),
          newAmount: new Prisma.Decimal('20'),
          originalDate: date,
          originalMethod: 'CASH',
          createdAt: new Date('2024-03-01'),
        },
        {
          sequence: 2,
          oldAmount: new Prisma.Decimal('20'),
          newAmount: new Prisma.Decimal('30'),
          originalDate: date,
          originalMethod: 'CASH',
          createdAt: new Date(secondDate),
        },
      );
      await service.correct(input, 'org', actor);
      expect(tx.payrollCashRevision.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { sequence: 'asc' } }),
      );
      expect(tx.payrollCashRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sequence: 3 }),
      });
    },
  );
  it.each([undefined, 0, -1, 1.5, 2, 2147483648])(
    'rejects malformed or missing initial sequence %s without writes',
    async (sequence) => {
      const { service, tx, installment } = setup();
      installment.revisions.push({
        sequence,
        oldAmount: new Prisma.Decimal('20'),
        newAmount: new Prisma.Decimal('30'),
        originalDate: date,
        originalMethod: 'CASH',
        createdAt: new Date('2024-03-01'),
      });
      await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      noWrites(tx);
    },
  );
  it.each([1, 3])(
    'rejects duplicate or missing sequence %s without writes',
    async (sequence) => {
      const { service, tx, installment } = setup();
      installment.revisions.push(
        {
          sequence: 1,
          oldAmount: new Prisma.Decimal('10'),
          newAmount: new Prisma.Decimal('20'),
          originalDate: date,
          originalMethod: 'CASH',
          createdAt: new Date('2024-03-01'),
        },
        {
          sequence,
          oldAmount: new Prisma.Decimal('20'),
          newAmount: new Prisma.Decimal('30'),
          originalDate: date,
          originalMethod: 'CASH',
          createdAt: new Date('2024-03-02'),
        },
      );
      await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      noWrites(tx);
    },
  );
  it('propagates revision write failure instead of reporting success', async () => {
    const { service, tx } = setup();
    const failure = new Error('revision write failed');
    tx.payrollCashRevision.create.mockRejectedValueOnce(failure);
    await expect(service.correct(input, 'org', actor)).rejects.toBe(failure);
  });
});
