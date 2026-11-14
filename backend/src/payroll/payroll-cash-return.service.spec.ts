import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { PayrollCashReturnService } from './payroll-cash-return.service';

const actor = {
  userId: 'u',
  organizationId: 'org',
  role: 'OWNER',
} as RequestUser;
const input = {
  employeeId: 'emp',
  obligationId: 'period',
  installmentId: 'inst',
  returnDate: '2024-02-29',
  returnMethod: 'TRANSFER',
};
const paidOn = new Date('2024-01-15T00:00:00.000Z');
const returnedOn = new Date('2024-02-29T00:00:00.000Z');

type Outflow = {
  id: string;
  organizationId: string;
  employeeId: string;
  amount: Prisma.Decimal;
  date: Date;
  method: string;
};

type Current = {
  id: string;
  organizationId: string;
  employeeId: string;
  obligationId: string;
  outflowId: string;
  outflow: Outflow;
  obligation: {
    id: string;
    organizationId: string;
    employeeId: string;
    status: string;
  };
};

function setup(overrides: { outflow?: Partial<Outflow> } = {}) {
  const outflow: Outflow = {
    id: 'cash',
    organizationId: 'org',
    employeeId: 'emp',
    amount: new Prisma.Decimal('120'),
    date: paidOn,
    method: 'CASH',
    ...overrides.outflow,
  };
  // The pre-lock lookup only locates the cash row; it is never authoritative.
  const located = { id: 'inst', outflowId: 'cash' };
  const current: Current = {
    id: 'inst',
    organizationId: 'org',
    employeeId: 'emp',
    obligationId: 'period',
    outflowId: 'cash',
    outflow,
    obligation: {
      id: 'period',
      organizationId: 'org',
      employeeId: 'emp',
      status: 'COMPLETED',
    },
  };
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'period' }])
      .mockResolvedValueOnce([{ id: 'cash' }]),
    payrollInstallment: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(located)
        .mockImplementation(async () => current),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    payrollCashReturn: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'return' }),
    },
    // Every other payroll, expense or audit write is a defect this suite must see.
    payrollCashOutflow: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    payrollObligation: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    payrollObligationExpense: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    expense: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    expensePayment: { create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const transaction = jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
    fn(tx),
  );
  return {
    tx,
    outflow,
    current,
    transaction,
    service: new PayrollCashReturnService({
      $transaction: transaction,
    } as unknown as PrismaService),
  };
}

/** A return appends one fact and touches no other record. */
function noOtherWrites(tx: ReturnType<typeof setup>['tx']) {
  expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  expect(tx.payrollCashOutflow.update).not.toHaveBeenCalled();
  expect(tx.payrollCashOutflow.updateMany).not.toHaveBeenCalled();
  expect(tx.payrollCashOutflow.delete).not.toHaveBeenCalled();
  expect(tx.payrollObligation.update).not.toHaveBeenCalled();
  expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
  expect(tx.payrollInstallment.create).not.toHaveBeenCalled();
  expect(tx.payrollInstallment.update).not.toHaveBeenCalled();
  expect(tx.payrollInstallment.delete).not.toHaveBeenCalled();
  expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
  expect(tx.payrollObligationExpense.update).not.toHaveBeenCalled();
  expect(tx.payrollObligationExpense.delete).not.toHaveBeenCalled();
  expect(tx.expense.create).not.toHaveBeenCalled();
  expect(tx.expense.update).not.toHaveBeenCalled();
  expect(tx.expense.updateMany).not.toHaveBeenCalled();
  expect(tx.expensePayment.create).not.toHaveBeenCalled();
  expect(tx.expensePayment.update).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
}

/** A rejected return writes nothing at all, not even the return row. */
function noWrites(tx: ReturnType<typeof setup>['tx']) {
  expect(tx.payrollCashReturn.create).not.toHaveBeenCalled();
  noOtherWrites(tx);
}

describe('PayrollCashReturnService (mock transactions only)', () => {
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

  it.each(['OWNER', 'ADMIN'])(
    'appends one full return for the %s of the tenant, locking employee then obligation then outflow',
    async (role) => {
      const { service, tx, transaction } = setup();
      const result = await service.create(input, 'org', {
        ...actor,
        role,
      } as RequestUser);
      expect(result).toMatchObject({ cashReturn: { id: 'return' } });
      expect(transaction).toHaveBeenCalledTimes(1);
      // Approved order: employee -> obligation -> outflow, every step tenant scoped.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
      expect(tx.$queryRaw.mock.calls[0][0].join('?')).toMatch(
        /FROM "Employee"[\s\S]*FOR UPDATE/,
      );
      expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['emp', 'org']);
      expect(tx.$queryRaw.mock.calls[1][0].join('?')).toMatch(
        /FROM "PayrollObligation"[\s\S]*FOR UPDATE/,
      );
      expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([
        'period',
        'org',
        'emp',
      ]);
      expect(tx.$queryRaw.mock.calls[2][0].join('?')).toMatch(
        /FROM "PayrollCashOutflow"[\s\S]*FOR UPDATE/,
      );
      expect(tx.$queryRaw.mock.calls[2].slice(1)).toEqual([
        'cash',
        'org',
        'emp',
      ]);
      // The money facts come from the locked outflow, never from the client.
      expect(tx.payrollCashReturn.create).toHaveBeenCalledTimes(1);
      const { data } = tx.payrollCashReturn.create.mock.calls[0][0];
      expect(data).toMatchObject({
        organizationId: 'org',
        employeeId: 'emp',
        obligationId: 'period',
        installmentId: 'inst',
        outflowId: 'cash',
        actorId: 'u',
        originalMethod: 'CASH',
        returnMethod: 'TRANSFER',
      });
      expect((data.amount as Prisma.Decimal).toFixed(2)).toBe('120.00');
      expect((data.originalAmount as Prisma.Decimal).toFixed(2)).toBe('120.00');
      expect(data.originalDate).toEqual(paidOn);
      // L325/L330: the actual day the money came back and its real method.
      expect(data.returnDate).toEqual(returnedOn);
      // The completed payment, its outflow, its expense and its link stay as they were.
      noOtherWrites(tx);
    },
  );

  it('checks previous returns of the same outflow, not only of the same installment', async () => {
    const { service, tx } = setup();
    await service.create(input, 'org', actor);
    expect(tx.payrollCashReturn.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org', employeeId: 'emp', outflowId: 'cash' },
    });
  });

  it('reads the previous returns only after the outflow is locked', async () => {
    const { service, tx } = setup();
    await service.create(input, 'org', actor);
    // Otherwise two concurrent returns of the same real cash could both pass the
    // cumulative check. Mocks prove ordering only; PostgreSQL is unverified here.
    expect(
      tx.payrollCashReturn.findMany.mock.invocationCallOrder[0],
    ).toBeGreaterThan(tx.$queryRaw.mock.invocationCallOrder[2]);
  });

  it.each(['MEMBER', 'CASHIER', 'INVENTORY_USER', 'SUPER_ADMIN'])(
    'rejects role %s before any work',
    async (role) => {
      const { service, transaction } = setup();
      await expect(
        service.create(input, 'org', { ...actor, role } as RequestUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing tenant', undefined, actor],
    ['missing actor', 'org', undefined],
    [
      'actor of another tenant',
      'org',
      { ...actor, organizationId: 'other' } as RequestUser,
    ],
    ['actor without a user id', 'org', { ...actor, userId: '' } as RequestUser],
  ])('rejects %s before any work', async (_label, organizationId, who) => {
    const { service, transaction } = setup();
    await expect(
      service.create(input, organizationId, who),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([[null], [[]], ['x'], [42]])(
    'rejects non-object input %p before any work',
    async (payload) => {
      const { service, transaction } = setup();
      await expect(
        service.create(payload, 'org', actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    '2024-02-30',
    '2024-2-9',
    '2024-02-29T00:00:00.000Z',
    '0000-01-01',
    '',
    'not-a-date',
  ])('rejects the return date %p', async (returnDate) => {
    const { service, transaction } = setup();
    await expect(
      service.create({ ...input, returnDate }, 'org', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([['BITCOIN'], [''], [1], [null]])(
    'rejects the return method %p',
    async (returnMethod) => {
      const { service, transaction } = setup();
      await expect(
        service.create({ ...input, returnMethod }, 'org', actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('refuses a client-supplied returned amount: one return is the full installment', async () => {
    const { service, transaction } = setup();
    await expect(
      service.create({ ...input, amount: '120.00' }, 'org', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['employeeId', ''],
    ['employeeId', '   '],
    ['obligationId', ''],
    ['installmentId', ''],
  ])('rejects a blank %s', async (field, value) => {
    const { service, transaction } = setup();
    await expect(
      service.create({ ...input, [field]: value }, 'org', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects an employee of another tenant without any write', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    noWrites(tx);
  });

  it('rejects an obligation of another employee without any write', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockReset();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([]);
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    noWrites(tx);
  });

  it('rejects an installment that does not belong to the payment without any write', async () => {
    const { service, tx } = setup();
    tx.payrollInstallment.findFirst.mockReset();
    tx.payrollInstallment.findFirst.mockResolvedValue(null);
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    noWrites(tx);
  });

  it('rejects a cash outflow that is no longer the tenant employee cash row', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockReset();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'period' }])
      .mockResolvedValueOnce([]);
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects an installment whose cash row changed between lookup and lock', async () => {
    const { service, tx, current } = setup();
    // Locate returned 'cash'; the authoritative re-read returns another outflow.
    current.outflowId = 'other-cash';
    current.outflow.id = 'other-cash';
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it.each(['PENDING', 'UNKNOWN'])(
    'rejects a payment that is not completed (%s) without any write',
    async (status) => {
      const { service, tx, current } = setup();
      current.obligation.status = status;
      await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      noWrites(tx);
    },
  );

  it.each([
    ['a zero outflow', '0'],
    ['a negative outflow', '-1'],
    ['a three-decimal outflow', '10.001'],
  ])('rejects %s as an inconsistent cash fact', async (_label, amount) => {
    const { service, tx } = setup({
      outflow: { amount: new Prisma.Decimal(amount) },
    });
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects a cash row whose stored tenant or employee identity disagrees', async () => {
    const { service, tx, current } = setup();
    current.outflow.employeeId = 'other-emp';
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects a second return of the same installment without any write', async () => {
    const { service, tx } = setup();
    tx.payrollCashReturn.findMany.mockResolvedValueOnce([
      {
        id: 'previous',
        installmentId: 'inst',
        outflowId: 'cash',
        amount: new Prisma.Decimal('120'),
      },
    ]);
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects a return of cash already returned through a copied installment of the same outflow', async () => {
    const { service, tx } = setup();
    // A copied pending payment references the same real cash row; the money can
    // only come back once, so the outflow-wide total is the guard.
    tx.payrollCashReturn.findMany.mockResolvedValueOnce([
      {
        id: 'previous',
        installmentId: 'copied-inst',
        outflowId: 'cash',
        amount: new Prisma.Decimal('120'),
      },
    ]);
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects a return that would push the cumulative returned cash over the outflow', async () => {
    const { service, tx } = setup();
    // Partial returns cannot be written by this service, but a corrupt or future
    // history must still be added up rather than treated as "any prior row".
    tx.payrollCashReturn.findMany.mockResolvedValueOnce([
      {
        id: 'previous-a',
        installmentId: 'copied-a',
        outflowId: 'cash',
        amount: new Prisma.Decimal('40'),
      },
      {
        id: 'previous-b',
        installmentId: 'copied-b',
        outflowId: 'cash',
        amount: new Prisma.Decimal('40'),
      },
    ]);
    await expect(service.create(input, 'org', actor)).rejects.toEqual(
      new ConflictException('El abono ya fue devuelto'),
    );
    noWrites(tx);
  });

  it.each(['0', '-120', '120.001'])(
    'fails closed on a corrupt stored return amount %p without any write',
    async (amount) => {
      const { service, tx } = setup();
      tx.payrollCashReturn.findMany.mockResolvedValueOnce([
        {
          id: 'previous',
          installmentId: 'copied-inst',
          outflowId: 'cash',
          amount: new Prisma.Decimal(amount),
        },
      ]);
      await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      noWrites(tx);
    },
  );

  it('propagates a write error without claiming rollback', async () => {
    const { service, tx } = setup();
    const error = new Error('write failed');
    tx.payrollCashReturn.create.mockRejectedValueOnce(error);
    await expect(service.create(input, 'org', actor)).rejects.toBe(error);
    expect(tx.payrollCashOutflow.updateMany).not.toHaveBeenCalled();
    expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
  });
});
