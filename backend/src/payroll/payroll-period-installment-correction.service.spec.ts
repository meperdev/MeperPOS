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
    installments: [installment],
  };
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'period' }])
      .mockResolvedValueOnce([{ id: 'cash' }]),
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
    payment: { create: jest.fn() },
    expense: { create: jest.fn() },
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
}

describe('pending fixed-period cash correction (mock transactions only)', () => {
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
  it.each(['100', '100.01'])(
    'temporarily fails closed at or above completion (%s)',
    async (amount) => {
      const { service, tx } = setup();
      await expect(
        service.correct({ ...input, amount }, 'org', actor),
      ).rejects.toBeInstanceOf(ConflictException);
      noWrites(tx);
    },
  );
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
