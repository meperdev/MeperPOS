import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { PayrollPeriodInstallmentsService } from './payroll-period-installments.service';

const actor = {
  userId: 'u',
  organizationId: 'org',
  role: 'OWNER',
} as RequestUser;
const input = {
  employeeId: 'emp',
  obligationId: 'period',
  amount: '40.00',
  date: '2024-02-29',
  method: 'CASH',
};

function setup() {
  const period = {
    id: 'period',
    kind: 'FIXED_PERIOD',
    status: 'PENDING',
    periodAmount: new Prisma.Decimal('100'),
    // Null is the unspecified stored choice, never "disabled".
    expenseEnabled: null as boolean | null,
    selectedExpenseDate: null as Date | null,
    installments: [
      {
        outflow: {
          id: 'old-cash',
          amount: new Prisma.Decimal('30'),
          date: new Date('2024-01-15T00:00:00.000Z'),
          method: 'CASH',
          _count: { installments: 1 },
        },
      },
    ],
  };
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'period' }])
      // Third lookup is the Organization lock of the category resolution.
      .mockResolvedValue([{ id: 'org' }]),
    payrollObligation: {
      findFirst: jest.fn().mockResolvedValue(period),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payrollCashOutflow: { create: jest.fn().mockResolvedValue({ id: 'cash' }) },
    payrollInstallment: {
      create: jest.fn().mockResolvedValue({ id: 'installment' }),
    },
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
  };
  const transaction = jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
    fn(tx),
  );
  return {
    tx,
    transaction,
    service: new PayrollPeriodInstallmentsService({
      $transaction: transaction,
    } as unknown as PrismaService),
  };
}

describe('PayrollPeriodInstallmentsService (mock transaction only)', () => {
  it('maps a transaction timeout to a retryable service error', async () => {
    const { service, transaction } = setup();
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('transaction expired', {
        code: 'P2028',
        clientVersion: 'test',
      }),
    );
    await expect(service.create(input, 'org', actor)).rejects.toMatchObject({
      status: 503,
      message:
        'No se pudo confirmar la operación. Verifique su estado antes de reintentar',
    });
  });

  it('records a real outflow and installment under employee then obligation locks, including for inactive employees', async () => {
    const { tx, service } = setup();
    const result = await service.create(input, 'org', actor);
    expect(result).toMatchObject({
      paid: '70.00',
      balance: '30.00',
      status: 'PENDING',
    });
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toMatch(
      /FROM "Employee"[\s\S]*FOR UPDATE/,
    );
    expect(tx.$queryRaw.mock.calls[1][0].join('?')).toMatch(
      /FROM "PayrollObligation"[\s\S]*FOR UPDATE/,
    );
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['emp', 'org']);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([
      'period',
      'org',
      'emp',
    ]);
    expect(tx.payrollCashOutflow.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org',
        employeeId: 'emp',
        actorId: 'u',
        amount: new Prisma.Decimal('40'),
        date: new Date('2024-02-29T00:00:00.000Z'),
        method: 'CASH',
      },
    });
    expect(tx.payrollInstallment.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org',
        employeeId: 'emp',
        obligationId: 'period',
        outflowId: 'cash',
      },
    });
  });
  it('completes only at the exact outstanding balance', async () => {
    const { tx, service } = setup();
    expect(
      await service.create({ ...input, amount: '70' }, 'org', actor),
    ).toMatchObject({ paid: '100.00', balance: '0.00', status: 'COMPLETED' });
    expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });
  it('rejects overpayment without creating an outflow', async () => {
    const { tx, service } = setup();
    await expect(
      service.create({ ...input, amount: '70.01' }, 'org', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  });
  it('fails closed on a shared cash identity until correction semantics exist', async () => {
    const { tx, service } = setup();
    const period = await tx.payrollObligation.findFirst();
    period.installments[0].outflow._count.installments = 2;
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  });
  it('rejects a shared outflow before an ordinary installment without writes', async () => {
    const { tx, service } = setup();
    const period = await tx.payrollObligation.findFirst();
    period.installments[0].outflow._count.installments = 2;
    period.installments.push({
      outflow: {
        amount: new Prisma.Decimal('20'),
        _count: { installments: 1 },
      },
    });
    await expect(service.create(input, 'org', actor)).rejects.toEqual(
      new ConflictException(
        'Abono compartido requiere protocolo de corrección',
      ),
    );
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
    expect(tx.payrollInstallment.create).not.toHaveBeenCalled();
    expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
  });
  it.each(['40', '50'])(
    'rejects a shared outflow after an ordinary installment for amount %s without writes',
    async (amount) => {
      const { tx, service } = setup();
      const period = await tx.payrollObligation.findFirst();
      period.installments.push({
        outflow: {
          amount: new Prisma.Decimal('20'),
          _count: { installments: 2 },
        },
      });
      await expect(
        service.create({ ...input, amount }, 'org', actor),
      ).rejects.toEqual(
        new ConflictException(
          'Abono compartido requiere protocolo de corrección',
        ),
      );
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
      expect(tx.payrollInstallment.create).not.toHaveBeenCalled();
      expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(['0', '-1', '1e2', '0.001', '1'.repeat(131073)])(
    'rejects invalid amount before transaction',
    async (amount) => {
      const { service, transaction } = setup();
      await expect(
        service.create({ ...input, amount }, 'org', actor),
      ).rejects.toThrow();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['COMPLETED', 'SHIFT_GROUP'])(
    'rejects unavailable obligation %s',
    async (value) => {
      const { tx, service } = setup();
      const period = await tx.payrollObligation.findFirst();
      if (value === 'COMPLETED') period.status = value;
      else period.kind = value;
      await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
    },
  );
  it('propagates a write error without claiming rollback', async () => {
    const { tx, service } = setup();
    const error = new Error('write failed');
    tx.payrollInstallment.create.mockRejectedValueOnce(error);
    await expect(service.create(input, 'org', actor)).rejects.toBe(error);
    expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a zero-count status update after both create calls', async () => {
    const { tx, service } = setup();
    tx.payrollObligation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.create(input, 'org', actor)).rejects.toEqual(
      new ConflictException('Pago modificado'),
    );
    expect(tx.payrollCashOutflow.create).toHaveBeenCalledTimes(1);
    expect(tx.payrollInstallment.create).toHaveBeenCalledTimes(1);
    expect(tx.payrollObligation.updateMany).toHaveBeenCalledTimes(1);
    expect(
      tx.payrollCashOutflow.create.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.payrollInstallment.create.mock.invocationCallOrder[0]);
    expect(
      tx.payrollInstallment.create.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.payrollObligation.updateMany.mock.invocationCallOrder[0]);
  });
  it.each(['outflow', 'installment', 'status'] as const)(
    'propagates the %s write error and stops at that boundary',
    async (boundary) => {
      const { tx, service } = setup();
      const error = new Error(`${boundary} write failed`);
      const writes = [
        tx.payrollCashOutflow.create,
        tx.payrollInstallment.create,
        tx.payrollObligation.updateMany,
      ];
      const failingIndex = ['outflow', 'installment', 'status'].indexOf(
        boundary,
      );
      writes[failingIndex].mockRejectedValueOnce(error);
      await expect(service.create(input, 'org', actor)).rejects.toBe(error);
      writes.forEach((write, index) => {
        expect(write).toHaveBeenCalledTimes(index <= failingIndex ? 1 : 0);
        if (index > 0 && index <= failingIndex)
          expect(writes[index - 1].mock.invocationCallOrder[0]).toBeLessThan(
            write.mock.invocationCallOrder[0],
          );
      });
    },
  );
  it('rejects unauthorized actors before a transaction', async () => {
    const { service, transaction } = setup();
    await expect(
      service.create(input, 'org', { ...actor, role: 'MEMBER' } as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  // S5/S8: the optional expense is written inside the completing transaction,
  // after the payroll locks and the tenant lock of the category resolution.
  // These mocks prove ordering and requested effects only; real rollback and
  // PostgreSQL locking stay unverified.
  describe('completion expense', () => {
    it('creates the expense, its payment mirrors and the payroll link in the same transaction', async () => {
      const { tx, transaction, service } = setup();
      const period = await tx.payrollObligation.findFirst();
      period.expenseEnabled = true;

      await expect(
        service.create({ ...input, amount: '70' }, 'org', actor),
      ).resolves.toMatchObject({ status: 'COMPLETED' });

      // The category resolution reuses this transaction and locks the tenant row
      // after the employee and obligation locks.
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
      expect(tx.$queryRaw.mock.calls[2][0].join('?')).toMatch(
        /FROM "Organization"[\s\S]*FOR UPDATE/,
      );
      expect(tx.$queryRaw.mock.calls[3][0].join('?')).toMatch(
        /FROM "ExpenseLabel"[\s\S]*JOIN "ExpenseGroup"[\s\S]*FOR UPDATE OF g, l/,
      );
      expect(tx.$queryRaw.mock.calls[2].slice(1)).toEqual(['org']);
      // Employee and obligation locks both precede the tenant lock.
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.$queryRaw.mock.invocationCallOrder[2],
      );
      expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        tx.$queryRaw.mock.invocationCallOrder[2],
      );
      expect(tx.payrollExpenseCategory.findUnique).toHaveBeenCalledWith({
        where: { organizationId: 'org' },
      });

      // Tenant and actor come from the validated request, never from the input.
      expect(tx.expense.create).toHaveBeenCalledTimes(1);
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
                amount: new Prisma.Decimal('30.00'),
                method: 'CASH',
                date: new Date('2024-01-15T05:00:00.000Z'),
              },
              {
                organizationId: 'org',
                amount: new Prisma.Decimal('70.00'),
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
      // The expense is written before the status transition it belongs to.
      expect(tx.expense.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.payrollObligation.updateMany.mock.invocationCallOrder[0],
      );
    });

    it('uses the stored expense date when the payment selected one', async () => {
      const { tx, service } = setup();
      const period = await tx.payrollObligation.findFirst();
      period.expenseEnabled = true;
      period.selectedExpenseDate = new Date('2024-03-05T00:00:00.000Z');

      await service.create({ ...input, amount: '70' }, 'org', actor);

      expect(
        (tx.expense.create.mock.calls[0][0] as { data: { date: Date } }).data
          .date,
      ).toEqual(new Date('2024-03-05T05:00:00.000Z'));
    });

    it.each([
      ['disabled', false],
      ['unknown', null],
    ])(
      'writes no expense and resolves no category when the choice is %s',
      async (_case, choice) => {
        const { tx, service } = setup();
        const period = await tx.payrollObligation.findFirst();
        period.expenseEnabled = choice;

        await expect(
          service.create({ ...input, amount: '70' }, 'org', actor),
        ).resolves.toMatchObject({ status: 'COMPLETED' });

        expect(tx.expense.create).not.toHaveBeenCalled();
        expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
        // No category work at all: only the employee and obligation locks ran.
        expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
        expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
        expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'COMPLETED' }),
          }),
        );
      },
    );

    it('writes no expense while the payment is not completed', async () => {
      const { tx, service } = setup();
      const period = await tx.payrollObligation.findFirst();
      period.expenseEnabled = true;

      await expect(service.create(input, 'org', actor)).resolves.toMatchObject({
        status: 'PENDING',
      });

      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('fails closed with no expense or status writes when the payroll category is inactive', async () => {
      const { tx, service } = setup();
      const period = await tx.payrollObligation.findFirst();
      period.expenseEnabled = true;
      tx.expenseGroup.findUnique.mockResolvedValueOnce({
        id: 'grp',
        active: false,
      });

      await expect(
        service.create({ ...input, amount: '70' }, 'org', actor),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
      expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
    });

    it('fails the whole completion above the expense limit without expense or status writes', async () => {
      const { tx, service } = setup();
      const period = await tx.payrollObligation.findFirst();
      period.expenseEnabled = true;
      period.periodAmount = new Prisma.Decimal('10000000000');
      period.installments.length = 0;

      await expect(
        service.create({ ...input, amount: '10000000000' }, 'org', actor),
      ).rejects.toThrow(
        'El gasto de nómina supera $9.999.999.999,99; el pago no se puede completar con gasto',
      );

      // The limit is decided before any category or expense work.
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
      // The mock has no rollback: it only proves the failed completion never
      // requests the later writes. Real rollback of the outflow/installment needs
      // PostgreSQL.
      expect(tx.payrollCashOutflow.create).toHaveBeenCalledTimes(1);
    });
  });
});
