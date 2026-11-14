import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { PayrollGroupInstallmentCorrectionService } from './payroll-group-installment-correction.service';

const actor = {
  userId: 'user',
  organizationId: 'org',
  role: 'OWNER',
} as RequestUser;
const input = {
  employeeId: 'emp',
  obligationId: 'group',
  installmentId: 'target',
  amount: '20.00',
};
const decimal = (value: string) => new Prisma.Decimal(value);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

type AllocationRow = {
  id: string;
  membershipId: string;
  amount: Prisma.Decimal;
  voids: unknown[];
};
type OutflowRow = {
  id: string;
  organizationId?: string;
  employeeId?: string;
  amount: Prisma.Decimal;
  date: Date;
  method: string;
  _count: { installments: number };
};
type InstallmentRow = {
  id: string;
  organizationId: string;
  employeeId: string;
  obligationId: string;
  outflowId: string;
  sequence: number | null;
  createdAt: Date;
  outflow: OutflowRow;
  allocations: AllocationRow[];
};
type MembershipRow = {
  id: string;
  shiftId: string;
  obligationId: string;
  releasedAt: Date | null;
  shift: { id: string; date: Date; amount: Prisma.Decimal };
  allocations: { id: string }[];
};

// s1 = 100.00, s2 = 100.00; 120.00 of 200.00 already recorded.
// first: s1 40 | target: s1 40 | later: s1 20 + s2 20.
function setup() {
  const memberships: MembershipRow[] = [
    {
      id: 'm1',
      shiftId: 's1',
      obligationId: 'group',
      releasedAt: null,
      shift: { id: 's1', date: day('2026-01-01'), amount: decimal('100') },
      allocations: [],
    },
    {
      id: 'm2',
      shiftId: 's2',
      obligationId: 'group',
      releasedAt: null,
      shift: { id: 's2', date: day('2026-01-02'), amount: decimal('100') },
      allocations: [],
    },
  ];
  const outflow = (
    id: string,
    amount: string,
    date: string,
    method: string,
  ): OutflowRow => ({
    id,
    organizationId: 'org',
    employeeId: 'emp',
    amount: decimal(amount),
    date: day(date),
    method,
    _count: { installments: 1 },
  });
  const allocations = (
    installmentId: string,
    rows: [string, string][],
  ): AllocationRow[] =>
    rows.map(([id, amount], index) => ({
      id,
      membershipId: id === 'a4' ? 'm2' : 'm1',
      amount: decimal(amount),
      voids: [],
      ...(installmentId && index >= 0 ? {} : {}),
    }));
  const installment = (
    id: string,
    sequence: number | null,
    outflowId: string,
    amount: string,
    date: string,
    method: string,
    rows: [string, string][],
  ): InstallmentRow => ({
    id,
    organizationId: 'org',
    employeeId: 'emp',
    obligationId: 'group',
    outflowId,
    sequence,
    createdAt: day(date),
    outflow: outflow(outflowId, amount, date, method),
    allocations: allocations(id, rows),
  });
  const group = {
    id: 'group',
    organizationId: 'org',
    employeeId: 'emp',
    kind: 'SHIFT_GROUP' as string,
    status: 'PENDING' as string,
    version: 3,
    periodAmount: null as Prisma.Decimal | null,
    // Null is the unspecified stored choice, never "disabled".
    expenseEnabled: null as boolean | null,
    selectedExpenseDate: null as Date | null,
    shiftMemberships: memberships,
    installments: [
      installment('first', 1, 'cash1', '40', '2026-02-01', 'CASH', [
        ['a1', '40'],
      ]),
      installment('target', 2, 'cash2', '40', '2026-02-02', 'TRANSFER', [
        ['a2', '40'],
      ]),
      installment('later', 3, 'cash3', '40', '2026-02-03', 'CASH', [
        ['a3', '20'],
        ['a4', '20'],
      ]),
    ],
  };
  const revisions: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'group' }])
      .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
      .mockResolvedValueOnce([{ id: 'cash2' }])
      // Fifth+ lookups are the Organization lock and the category reads.
      .mockResolvedValue([{ id: 'org' }]),
    payrollShiftMembership: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(
          memberships.map(({ id, shiftId }) => ({ id, shiftId })),
        )
        .mockImplementation(async () => memberships),
    },
    payrollObligation: {
      findFirst: jest.fn().mockImplementation(async () => group),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payrollAllocationVoid: {
      createMany: jest
        .fn()
        .mockImplementation(async ({ data }: { data: unknown[] }) => ({
          count: data.length,
        })),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    payrollAllocation: {
      createMany: jest
        .fn()
        .mockImplementation(async ({ data }: { data: unknown[] }) => ({
          count: data.length,
        })),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    payrollCashOutflow: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    payrollInstallment: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      createMany: jest.fn(),
    },
    payrollCashRevision: {
      findMany: jest.fn().mockImplementation(async () => revisions),
      create: jest.fn().mockResolvedValue({ id: 'revision' }),
      update: jest.fn(),
      delete: jest.fn(),
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
    payment: { create: jest.fn() },
  };
  const transaction = jest.fn(
    async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  );
  const service = new PayrollGroupInstallmentCorrectionService({
    $transaction: transaction,
  } as unknown as PrismaService);
  return { service, tx, group, memberships, revisions, transaction };
}

// Every rejection must leave the persisted facts untouched: no void, no
// replacement application, no cash revision, no amount change, no status change
// and no expense.
function noWrites(tx: ReturnType<typeof setup>['tx']) {
  expect(tx.payrollAllocationVoid.createMany).not.toHaveBeenCalled();
  expect(tx.payrollAllocationVoid.create).not.toHaveBeenCalled();
  expect(tx.payrollAllocationVoid.update).not.toHaveBeenCalled();
  expect(tx.payrollAllocationVoid.delete).not.toHaveBeenCalled();
  expect(tx.payrollAllocationVoid.deleteMany).not.toHaveBeenCalled();
  expect(tx.payrollAllocation.createMany).not.toHaveBeenCalled();
  expect(tx.payrollAllocation.update).not.toHaveBeenCalled();
  expect(tx.payrollAllocation.updateMany).not.toHaveBeenCalled();
  expect(tx.payrollAllocation.delete).not.toHaveBeenCalled();
  expect(tx.payrollAllocation.deleteMany).not.toHaveBeenCalled();
  expect(tx.payrollCashOutflow.updateMany).not.toHaveBeenCalled();
  expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  expect(tx.payrollCashOutflow.update).not.toHaveBeenCalled();
  expect(tx.payrollCashOutflow.delete).not.toHaveBeenCalled();
  expect(tx.payrollInstallment.create).not.toHaveBeenCalled();
  expect(tx.payrollInstallment.update).not.toHaveBeenCalled();
  expect(tx.payrollInstallment.delete).not.toHaveBeenCalled();
  expect(tx.payrollInstallment.createMany).not.toHaveBeenCalled();
  expect(tx.payrollCashRevision.create).not.toHaveBeenCalled();
  expect(tx.payrollCashRevision.update).not.toHaveBeenCalled();
  expect(tx.payrollCashRevision.delete).not.toHaveBeenCalled();
  expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
  expect(tx.expense.create).not.toHaveBeenCalled();
  expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
  expect(tx.payment.create).not.toHaveBeenCalled();
}

// A `$queryRaw` call is either a tagged template (array of strings) or a
// `Prisma.sql` object; both expose their text so a lock statement can be read.
function lockSql(call: unknown[]): string {
  const [first] = call;
  if (Array.isArray(first)) return first.join('?');
  const sql = first as { sql?: string; text?: string };
  return sql.sql ?? sql.text ?? '';
}

// Bound values of the same call: a tagged template keeps them in the call, a
// `Prisma.sql` object keeps them (possibly nested by `Prisma.join`) inside it.
function lockValues(call: unknown[]): unknown[] {
  const flatten = (values: unknown[]): unknown[] =>
    values.flatMap((value) => {
      if (Array.isArray(value)) return value;
      const nested = (value as { values?: unknown[] }).values;
      return nested ? flatten(nested) : [value];
    });
  const [first] = call;
  if (Array.isArray(first)) return flatten(call.slice(1));
  return flatten((first as { values?: unknown[] }).values ?? []);
}

// The completion day is derived from the clock, so completion tests pin it.
function at(instant: string) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(instant));
}

describe('grouped installment correction (mock transactions only)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

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

  it.each(['OWNER', 'ADMIN'])(
    'recalculates from the corrected installment in registration order for %s',
    async (role) => {
      const { service, tx, transaction } = setup();
      await expect(
        service.correct(input, 'org', { ...actor, role } as RequestUser),
      ).resolves.toMatchObject({
        installmentId: 'target',
        paid: '100.00',
        balance: '100.00',
        status: 'PENDING',
      });
      expect(transaction).toHaveBeenCalledTimes(1);

      // Lock order: employee -> obligation -> sorted member shifts -> cash row.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
      for (const [index, table] of [
        'Employee',
        'PayrollObligation',
        'EmployeeShift',
        'PayrollCashOutflow',
      ].entries()) {
        expect(lockSql(tx.$queryRaw.mock.calls[index])).toMatch(
          new RegExp(`FROM "${table}"[\\s\\S]*FOR UPDATE`),
        );
      }
      expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['emp', 'org']);
      expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([
        'group',
        'org',
        'emp',
      ]);
      expect(lockValues(tx.$queryRaw.mock.calls[2])).toEqual([
        'org',
        'emp',
        's1',
        's2',
      ]);
      expect(lockSql(tx.$queryRaw.mock.calls[2])).toMatch(
        /ORDER BY "id" FOR UPDATE/,
      );
      expect(tx.$queryRaw.mock.calls[3].slice(1)).toEqual([
        'cash2',
        'org',
        'emp',
      ]);

      // Every superseded application is voided, never edited or deleted: the
      // target and the later installment are recalculated, the first is not.
      expect(tx.payrollAllocationVoid.createMany).toHaveBeenCalledTimes(1);
      expect(tx.payrollAllocationVoid.createMany).toHaveBeenCalledWith({
        data: [
          {
            allocationId: 'a2',
            obligationId: 'group',
            organizationId: 'org',
            employeeId: 'emp',
          },
          {
            allocationId: 'a3',
            obligationId: 'group',
            organizationId: 'org',
            employeeId: 'emp',
          },
          {
            allocationId: 'a4',
            obligationId: 'group',
            organizationId: 'org',
            employeeId: 'emp',
          },
        ],
      });
      // Replacements land on the same installments, with the same membership
      // identity the shift already had.
      expect(tx.payrollAllocation.createMany).toHaveBeenCalledTimes(1);
      expect(tx.payrollAllocation.createMany).toHaveBeenCalledWith({
        data: [
          {
            organizationId: 'org',
            employeeId: 'emp',
            obligationId: 'group',
            installmentId: 'target',
            membershipId: 'm1',
            amount: decimal('20'),
          },
          {
            organizationId: 'org',
            employeeId: 'emp',
            obligationId: 'group',
            installmentId: 'later',
            membershipId: 'm1',
            amount: decimal('40'),
          },
        ],
      });

      // The corrected cash row keeps its date and method; only the amount moves,
      // through a compare-and-swap on the facts the locks established.
      expect(tx.payrollCashOutflow.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.payrollCashOutflow.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'cash2',
          organizationId: 'org',
          employeeId: 'emp',
          amount: decimal('40'),
          date: day('2026-02-02'),
          method: 'TRANSFER',
        },
        data: { amount: decimal('20') },
      });
      expect(tx.payrollCashRevision.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org',
          employeeId: 'emp',
          obligationId: 'group',
          installmentId: 'target',
          outflowId: 'cash2',
          actorId: 'user',
          sequence: 1,
          oldAmount: decimal('40'),
          newAmount: decimal('20'),
          originalDate: day('2026-02-02'),
          originalMethod: 'TRANSFER',
        },
      });
      // A correction never invents or removes cash rows or installments.
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
      expect(tx.payrollCashOutflow.delete).not.toHaveBeenCalled();
      expect(tx.payrollInstallment.create).not.toHaveBeenCalled();
      expect(tx.payrollInstallment.delete).not.toHaveBeenCalled();
      // Ordering: void evidence, then replacements, then the revised cash amount,
      // then its revision, then the obligation status as the last effect.
      const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
        mock.mock.invocationCallOrder[0];
      expect(order(tx.payrollAllocationVoid.createMany)).toBeLessThan(
        order(tx.payrollAllocation.createMany),
      );
      expect(order(tx.payrollAllocation.createMany)).toBeLessThan(
        order(tx.payrollCashOutflow.updateMany),
      );
      expect(order(tx.payrollCashOutflow.updateMany)).toBeLessThan(
        order(tx.payrollCashRevision.create),
      );
      expect(order(tx.payrollCashRevision.create)).toBeLessThan(
        order(tx.payrollObligation.updateMany),
      );
      expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'group',
          organizationId: 'org',
          employeeId: 'emp',
          kind: 'SHIFT_GROUP',
          status: 'PENDING',
          version: 3,
        },
        data: { status: 'PENDING', version: { increment: 1 } },
      });
      // A pending correction writes no expense and resolves no category.
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
    },
  );

  it('orders and allocates by registration sequence, not by stored date', async () => {
    const { service, tx, group } = setup();
    // Same registration order, but the later installment was backdated and the
    // rows are returned in an unrelated order.
    group.installments = [
      group.installments[2],
      group.installments[0],
      group.installments[1],
    ];
    group.installments[0].outflow.date = day('2026-01-15');
    group.installments[1].outflow.date = day('2026-02-01');
    group.installments[2].outflow.date = day('2026-02-02');
    await service.correct(input, 'org', actor);
    // Registration order keeps the backdated installment last, so it is the one
    // recalculated after the corrected target instead of being preserved.
    expect(tx.payrollAllocationVoid.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ allocationId: 'a2' }),
        expect.objectContaining({ allocationId: 'a3' }),
        expect.objectContaining({ allocationId: 'a4' }),
      ],
    });
    expect(tx.payrollAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          installmentId: 'target',
          membershipId: 'm1',
          amount: decimal('20'),
        }),
        expect.objectContaining({
          installmentId: 'later',
          membershipId: 'm1',
          amount: decimal('40'),
        }),
      ],
    });
  });

  it('leaves an unchanged later installment without void or replacement', async () => {
    const { service, tx, group } = setup();
    // s2 carries the target and the later installment, so reducing the target
    // leaves the later allocation identical.
    group.installments = [
      {
        ...group.installments[0],
        outflow: {
          ...group.installments[0].outflow,
          amount: decimal('100'),
        },
        allocations: [
          { id: 'a1', membershipId: 'm1', amount: decimal('100'), voids: [] },
        ],
      },
      {
        ...group.installments[1],
        allocations: [
          { id: 'a2', membershipId: 'm2', amount: decimal('40'), voids: [] },
        ],
      },
      {
        ...group.installments[2],
        allocations: [
          { id: 'a3', membershipId: 'm2', amount: decimal('40'), voids: [] },
        ],
      },
    ];
    await expect(service.correct(input, 'org', actor)).resolves.toMatchObject({
      paid: '160.00',
      balance: '40.00',
    });
    expect(tx.payrollAllocationVoid.createMany).toHaveBeenCalledWith({
      data: [
        {
          allocationId: 'a2',
          obligationId: 'group',
          organizationId: 'org',
          employeeId: 'emp',
        },
      ],
    });
    expect(tx.payrollAllocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: 'org',
          employeeId: 'emp',
          obligationId: 'group',
          installmentId: 'target',
          membershipId: 'm2',
          amount: decimal('20'),
        },
      ],
    });
  });

  it('ignores already voided applications when reconciling cash', async () => {
    const { service, tx, group } = setup();
    // The target already carries a superseded application: it must not be
    // counted as effective, re-voided, nor replaced.
    group.installments[1].allocations = [
      { id: 'a2old', membershipId: 'm1', amount: decimal('10'), voids: [{}] },
      { id: 'a2', membershipId: 'm1', amount: decimal('40'), voids: [] },
    ];
    await expect(service.correct(input, 'org', actor)).resolves.toMatchObject({
      paid: '100.00',
    });
    const voided = tx.payrollAllocationVoid.createMany.mock.calls[0][0] as {
      data: { allocationId: string }[];
    };
    expect(voided.data.map(({ allocationId }) => allocationId)).toEqual([
      'a2',
      'a3',
      'a4',
    ]);
  });

  it('shares one cash row never: a shared outflow is rejected without writes', async () => {
    const { service, tx, group } = setup();
    group.installments[1].outflow._count.installments = 2;
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects cash that does not equal its effective applications', async () => {
    const { service, tx, group } = setup();
    group.installments[2].outflow.amount = decimal('41');
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects two effective applications for the same membership', async () => {
    const { service, tx, group } = setup();
    group.installments[2].allocations.push({
      id: 'a5',
      membershipId: 'm1',
      amount: decimal('0.01'),
      voids: [],
    });
    group.installments[2].outflow.amount = decimal('40.01');
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects a released membership that still carries applications', async () => {
    const { service, tx, memberships } = setup();
    memberships[1].releasedAt = new Date('2026-02-01T00:00:00Z');
    const detail = jest.fn().mockImplementation(async () =>
      memberships.map((membership) => ({
        ...membership,
        allocations: membership.releasedAt ? [{ id: 'a4' }] : [],
      })),
    );
    tx.payrollShiftMembership.findMany.mockImplementation(detail);
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects a membership change detected against the pre-lock snapshot', async () => {
    const { service, tx, memberships } = setup();
    // The pre-lock read saw one membership; the locked re-read sees two.
    tx.payrollShiftMembership.findMany
      .mockReset()
      .mockResolvedValueOnce([{ id: 'm1', shiftId: 's1' }])
      .mockImplementation(async () => memberships);
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'group' }])
      .mockResolvedValueOnce([{ id: 's1' }])
      .mockResolvedValueOnce([{ id: 'cash2' }]);
    await expect(service.correct(input, 'org', actor)).rejects.toMatchObject({
      message: 'Historial de grupo inconsistente',
    });
    noWrites(tx);
  });

  it.each([null, 3])(
    'rejects unprovable registration order %s without writes',
    async (sequence) => {
      const { service, tx, group } = setup();
      group.installments[1].sequence = sequence;
      await expect(service.correct(input, 'org', actor)).rejects.toMatchObject({
        message: 'Orden de registro de abonos no verificable',
      });
      noWrites(tx);
    },
  );

  it('rejects an unchanged amount without writes', async () => {
    const { service, tx } = setup();
    await expect(
      service.correct({ ...input, amount: '40.00' }, 'org', actor),
    ).rejects.toMatchObject({ message: 'El importe no cambió' });
    noWrites(tx);
  });

  it('rejects a correction above the group balance without writes', async () => {
    const { service, tx } = setup();
    await expect(
      service.correct({ ...input, amount: '140.00' }, 'org', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    noWrites(tx);
    expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a broken revision chain of the corrected cash row', async () => {
    const { service, tx, revisions } = setup();
    revisions.push({
      sequence: 2,
      oldAmount: decimal('30'),
      newAmount: decimal('40'),
      originalDate: day('2026-02-02'),
      originalMethod: 'TRANSFER',
    });
    await expect(service.correct(input, 'org', actor)).rejects.toMatchObject({
      message: 'Historial de correcciones inconsistente',
    });
    noWrites(tx);
  });

  it('appends the next revision after a continuous chain', async () => {
    const { service, tx, revisions } = setup();
    revisions.push({
      sequence: 1,
      oldAmount: decimal('30'),
      newAmount: decimal('40'),
      originalDate: day('2026-02-02'),
      originalMethod: 'TRANSFER',
    });
    await service.correct(input, 'org', actor);
    expect(tx.payrollCashRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequence: 2,
        oldAmount: decimal('40'),
        newAmount: decimal('20'),
      }),
    });
  });

  it('rejects a revision chain whose last amount disagrees with the cash row', async () => {
    const { service, tx, revisions } = setup();
    revisions.push({
      sequence: 1,
      oldAmount: decimal('30'),
      newAmount: decimal('35'),
      originalDate: day('2026-02-02'),
      originalMethod: 'TRANSFER',
    });
    await expect(service.correct(input, 'org', actor)).rejects.toMatchObject({
      message: 'Historial de correcciones inconsistente',
    });
    noWrites(tx);
  });

  it.each(['COMPLETED'])(
    'rejects an unavailable group status %s',
    async (s) => {
      const { service, tx, group } = setup();
      group.status = s;
      await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      noWrites(tx);
    },
  );

  it('rejects a fixed-period obligation', async () => {
    const { service, tx, group } = setup();
    group.kind = 'FIXED_PERIOD';
    await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    noWrites(tx);
  });

  it('rejects an installment of another payment', async () => {
    const { service, tx } = setup();
    await expect(
      service.correct({ ...input, installmentId: 'missing' }, 'org', actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    noWrites(tx);
  });

  it('rejects a changed membership or shift set', async () => {
    const { service, tx } = setup();
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'group' }])
      .mockResolvedValueOnce([{ id: 's1' }, { id: 'other' }]);
    await expect(service.correct(input, 'org', actor)).rejects.toMatchObject({
      message: 'Turnos modificados',
    });
    noWrites(tx);
  });

  it('rejects a missing cash row lock', async () => {
    const { service, tx } = setup();
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: 'emp' }])
      .mockResolvedValueOnce([{ id: 'group' }])
      .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
      .mockResolvedValueOnce([]);
    await expect(service.correct(input, 'org', actor)).rejects.toMatchObject({
      message: 'Movimiento no disponible',
    });
    noWrites(tx);
  });

  it('rejects an employee or obligation outside the tenant', async () => {
    for (const locks of [[[]], [[{ id: 'emp' }], []]] as const) {
      const { service, tx } = setup();
      tx.$queryRaw.mockReset();
      for (const result of locks) tx.$queryRaw.mockResolvedValueOnce(result);
      await expect(service.correct(input, 'org', actor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      noWrites(tx);
      expect(tx.$queryRaw.mock.calls[0].slice(1)).toContain('org');
    }
  });

  it('rejects a cash compare-and-swap that no longer matches', async () => {
    const { service, tx } = setup();
    tx.payrollCashOutflow.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.correct(input, 'org', actor)).rejects.toMatchObject({
      message: 'Movimiento modificado',
    });
    expect(tx.payrollCashRevision.create).not.toHaveBeenCalled();
    expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a status compare-and-swap that no longer matches', async () => {
    const { service, tx } = setup();
    tx.payrollObligation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.correct(input, 'org', actor)).rejects.toMatchObject({
      message: 'Pago modificado',
    });
    expect(tx.payrollObligation.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    { ...actor, role: 'MEMBER' },
    { ...actor, organizationId: 'other' },
    { ...actor, userId: '' },
  ])(
    'rejects an unauthorized or cross-tenant actor before the transaction',
    async (who) => {
      const { service, transaction } = setup();
      await expect(
        service.correct(input, 'org', who as RequestUser | undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing tenant before the transaction', async () => {
    const { service, transaction } = setup();
    await expect(
      service.correct(input, undefined, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '0.001', '1e2', '1'.repeat(131073), '', 'bad'])(
    'rejects an invalid corrected amount %s before the transaction',
    async (amount) => {
      const { service, transaction } = setup();
      await expect(
        service.correct({ ...input, amount }, 'org', actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    { employeeId: '' },
    { installmentId: 7 },
    { method: 'CASH' },
    { date: '2026-02-02' },
    { organizationId: 'org-other' },
  ])(
    'rejects a body outside the {employeeId, obligationId, installmentId, amount} whitelist',
    async (extra) => {
      const { service, transaction } = setup();
      await expect(
        service.correct({ ...input, ...extra }, 'org', actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  // S4/S5: a correction that makes the group exactly complete applies the stored
  // expense choice through the existing seam, before the status it belongs to.
  describe('exact completion', () => {
    it('completes the group and writes the chosen expense in this transaction', async () => {
      const { service, tx, group } = setup();
      group.expenseEnabled = true;
      // The Bogotá correction day, distinct from every outflow date.
      at('2026-03-05T02:30:00.000Z');

      await expect(
        service.correct({ ...input, amount: '120.00' }, 'org', actor),
      ).resolves.toMatchObject({
        paid: '200.00',
        balance: '0.00',
        status: 'COMPLETED',
      });

      expect(tx.payrollAllocationVoid.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ allocationId: 'a2' }),
          expect.objectContaining({ allocationId: 'a3' }),
          expect.objectContaining({ allocationId: 'a4' }),
        ],
      });
      expect(tx.payrollAllocation.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            installmentId: 'target',
            membershipId: 'm1',
            amount: decimal('60'),
          }),
          expect.objectContaining({
            installmentId: 'target',
            membershipId: 'm2',
            amount: decimal('60'),
          }),
          expect.objectContaining({
            installmentId: 'later',
            membershipId: 'm2',
            amount: decimal('40'),
          }),
        ],
      });
      // The category resolution runs inside this transaction, after the payroll
      // locks, so the expense shares the completion's fate.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(6);
      expect(lockSql(tx.$queryRaw.mock.calls[4])).toMatch(
        /FROM "Organization"[\s\S]*FOR UPDATE/,
      );
      expect(lockSql(tx.$queryRaw.mock.calls[5])).toMatch(
        /FROM "ExpenseLabel"[\s\S]*FOR UPDATE OF g, l/,
      );
      expect(tx.payrollExpenseCategory.findUnique).toHaveBeenCalledWith({
        where: { organizationId: 'org' },
      });
      expect(tx.expense.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org',
          labelId: 'lbl',
          description: null,
          // No selected date: the Bogotá correction day, not the outflow date.
          date: new Date('2026-03-04T05:00:00.000Z'),
          total: decimal('200.00'),
          status: 'PAID',
          createdById: 'user',
          payments: {
            create: [
              {
                organizationId: 'org',
                amount: decimal('40.00'),
                method: 'CASH',
                date: new Date('2026-02-01T05:00:00.000Z'),
              },
              {
                organizationId: 'org',
                amount: decimal('120.00'),
                method: 'TRANSFER',
                date: new Date('2026-02-02T05:00:00.000Z'),
              },
              {
                organizationId: 'org',
                amount: decimal('40.00'),
                method: 'CASH',
                date: new Date('2026-02-03T05:00:00.000Z'),
              },
            ],
          },
        },
        select: { id: true },
      });
      expect(tx.payrollObligationExpense.create).toHaveBeenCalledWith({
        data: {
          obligationId: 'group',
          organizationId: 'org',
          employeeId: 'emp',
          expenseId: 'expense',
        },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user',
            organizationId: 'org',
            action: 'EXPENSE_CREATED',
            resource: 'Expense',
            resourceId: 'expense',
          }),
        }),
      );
      // The status CAS is the last effect, after the expense it belongs to.
      expect(tx.expense.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.payrollObligation.updateMany.mock.invocationCallOrder[0],
      );
      expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: 'PENDING', version: 3 }),
        data: { status: 'COMPLETED', version: { increment: 1 } },
      });
    });

    it('uses the stored expense date when the payment selected one', async () => {
      const { service, tx, group } = setup();
      group.expenseEnabled = true;
      group.selectedExpenseDate = day('2026-03-05');
      at('2026-04-10T15:00:00.000Z');
      await service.correct({ ...input, amount: '120.00' }, 'org', actor);
      const created = (
        tx.expense.create.mock.calls[0][0] as {
          data: { date: Date; payments: { create: Array<{ date: Date }> } };
        }
      ).data;
      expect(created.date).toEqual(new Date('2026-03-05T05:00:00.000Z'));
      // The stored selection changes the expense date only, never the cash dates.
      expect(created.payments.create[1].date).toEqual(
        new Date('2026-02-02T05:00:00.000Z'),
      );
    });

    it.each([
      ['disabled', false],
      ['unknown', null],
    ])(
      'completes without an expense when the choice is %s',
      async (_case, choice) => {
        const { service, tx, group } = setup();
        group.expenseEnabled = choice;
        await expect(
          service.correct({ ...input, amount: '120.00' }, 'org', actor),
        ).resolves.toMatchObject({ status: 'COMPLETED' });
        expect(tx.expense.create).not.toHaveBeenCalled();
        expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
        // No category work at all: only the four payroll locks ran.
        expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
        expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
        expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { status: 'COMPLETED', version: { increment: 1 } },
          }),
        );
      },
    );

    it('fails closed above the expense limit before any money write', async () => {
      const { service, tx, group } = setup();
      group.expenseEnabled = true;
      group.shiftMemberships[0].shift.amount = decimal('6000000000');
      group.shiftMemberships[1].shift.amount = decimal('6000000000');
      // The correction makes 12.000.000.000,00 paid in full, which exceeds the
      // Decimal(12,2) expense boundary.
      await expect(
        service.correct({ ...input, amount: '11999999920.00' }, 'org', actor),
      ).rejects.toThrow(
        'El gasto de nómina supera $9.999.999.999,99; el pago no se puede completar con gasto',
      );
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollAllocationVoid.createMany).not.toHaveBeenCalled();
      expect(tx.payrollAllocation.createMany).not.toHaveBeenCalled();
      expect(tx.payrollCashOutflow.updateMany).not.toHaveBeenCalled();
      expect(tx.payrollCashRevision.create).not.toHaveBeenCalled();
      expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
    });
  });
});
