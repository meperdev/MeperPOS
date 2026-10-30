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
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'period' }]),
    payrollObligation: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'period',
        kind: 'FIXED_PERIOD',
        status: 'PENDING',
        periodAmount: new Prisma.Decimal('100'),
        installments: [
          {
            outflow: {
              amount: new Prisma.Decimal('30'),
              _count: { installments: 1 },
            },
          },
        ],
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payrollCashOutflow: { create: jest.fn().mockResolvedValue({ id: 'cash' }) },
    payrollInstallment: {
      create: jest.fn().mockResolvedValue({ id: 'installment' }),
    },
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
});
