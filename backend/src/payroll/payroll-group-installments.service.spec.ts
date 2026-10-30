import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { PayrollGroupInstallmentsService } from './payroll-group-installments.service';

const actor = {
  userId: 'user',
  organizationId: 'org',
  role: 'OWNER',
} as RequestUser;
const input = {
  employeeId: 'emp',
  obligationId: 'group',
  amount: '12.00',
  date: '2024-02-29',
  method: 'CASH',
};
const decimal = (s: string) => new Prisma.Decimal(s);
function setup() {
  const memberships = [
    {
      id: 'm2',
      shiftId: 's2',
      obligationId: 'group',
      releasedAt: null,
      allocations: [],
      shift: {
        id: 's2',
        date: new Date('2024-01-01T00:00:00Z'),
        amount: decimal('20'),
      },
    },
    {
      id: 'm1',
      shiftId: 's1',
      obligationId: 'group',
      releasedAt: null,
      allocations: [],
      shift: {
        id: 's1',
        date: new Date('2024-01-02T00:00:00Z'),
        amount: decimal('10'),
      },
    },
  ];
  const group = {
    id: 'group',
    kind: 'SHIFT_GROUP',
    status: 'PENDING',
    version: 3,
    // Null is the unspecified stored choice, never "disabled".
    expenseEnabled: null as boolean | null,
    selectedExpenseDate: null as Date | null,
    shiftMemberships: memberships,
    installments: [
      {
        id: 'old',
        outflowId: 'oldcash',
        outflow: {
          id: 'oldcash',
          amount: decimal('5'),
          date: new Date('2024-01-15T00:00:00.000Z'),
          method: 'CASH',
          _count: { installments: 1 },
        },
        allocations: [
          {
            id: 'a1',
            membershipId: 'm1',
            amount: decimal('5'),
            voids: [] as unknown[],
          },
        ],
      },
    ],
  };
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'emp', active: false }])
      .mockResolvedValueOnce([{ id: 'group' }])
      .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
      // Fourth lookup is the Organization lock of the category resolution.
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
      findFirst: jest.fn().mockResolvedValue(group),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payrollCashOutflow: { create: jest.fn().mockResolvedValue({ id: 'cash' }) },
    payrollInstallment: { create: jest.fn().mockResolvedValue({ id: 'new' }) },
    payrollAllocation: {
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown[] }) =>
          Promise.resolve({ count: data.length }),
        ),
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
  const transaction = jest.fn(
    async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
  );
  const service = new PayrollGroupInstallmentsService({
    $transaction: transaction,
  } as unknown as PrismaService);
  return { service, tx, group, memberships, transaction };
}

// Number of `$queryRaw` lock statements issued so far: employee, obligation,
// shifts and, only for an expense-enabled completion, the Organization row.
const transactionCount = (tx: ReturnType<typeof setup>['tx']): number =>
  tx.$queryRaw.mock.calls.length;

describe('group installment (mock transaction, not database locks or rollback)', () => {
  it('preserves historical application and allocates only new cash by current dates, after ordered locks', async () => {
    const { service, tx } = setup();
    const result = await service.create(input, 'org', actor);
    expect(result).toMatchObject({
      paid: '17.00',
      balance: '13.00',
      status: 'PENDING',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toMatch(
      /FROM "Employee"[\s\S]*FOR UPDATE/,
    );
    expect(tx.$queryRaw.mock.calls[1][0].join('?')).toMatch(
      /FROM "PayrollObligation"[\s\S]*FOR UPDATE/,
    );
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['emp', 'org']);
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([
      'group',
      'org',
      'emp',
    ]);
    const lock = tx.$queryRaw.mock.calls[2][0] as Prisma.Sql;
    expect(lock.sql).toMatch(
      /FROM "EmployeeShift"[\s\S]*ORDER BY "id" FOR UPDATE/,
    );
    expect(lock.values).toEqual(['org', 'emp', 's1', 's2']);
    expect(tx.payrollAllocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: 'org',
          employeeId: 'emp',
          obligationId: 'group',
          installmentId: 'new',
          membershipId: 'm2',
          amount: decimal('12'),
        },
      ],
    });
    const order = [
      tx.$queryRaw.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[1],
      tx.payrollShiftMembership.findMany.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[2],
      tx.payrollObligation.findFirst.mock.invocationCallOrder[0],
      tx.payrollShiftMembership.findMany.mock.invocationCallOrder[1],
      tx.payrollCashOutflow.create.mock.invocationCallOrder[0],
      tx.payrollInstallment.create.mock.invocationCallOrder[0],
      tx.payrollAllocation.createMany.mock.invocationCallOrder[0],
      tx.payrollObligation.updateMany.mock.invocationCallOrder[0],
    ];
    expect(order.every((n, i) => i === 0 || order[i - 1] < n)).toBe(true);
    expect(tx.payrollCashOutflow.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org',
        employeeId: 'emp',
        actorId: 'user',
        amount: decimal('12'),
        date: new Date('2024-02-29T00:00:00Z'),
        method: 'CASH',
      },
    });
    expect(tx.payrollInstallment.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org',
        employeeId: 'emp',
        obligationId: 'group',
        outflowId: 'cash',
      },
    });
  });
  it('completes on exact balance and splits new allocation across current dates', async () => {
    const { service, tx } = setup();
    expect(
      await service.create({ ...input, amount: '25' }, 'org', actor),
    ).toMatchObject({ paid: '30.00', balance: '0.00', status: 'COMPLETED' });
    expect(
      tx.payrollAllocation.createMany.mock.calls[0][0].data.map(
        (a: { membershipId: string; amount: Prisma.Decimal }) => [
          a.membershipId,
          a.amount.toFixed(2),
        ],
      ),
    ).toEqual([
      ['m2', '20.00'],
      ['m1', '5.00'],
    ]);
    expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'COMPLETED', version: { increment: 1 } },
      }),
    );
  });
  it('allows an administrator to make the first payment', async () => {
    const { service, group } = setup();
    group.installments.length = 0;
    expect(
      await service.create(input, 'org', {
        ...actor,
        role: 'ADMIN',
      } as RequestUser),
    ).toMatchObject({ paid: '12.00', balance: '18.00', status: 'PENDING' });
  });
  it.each(['employee', 'obligation', 'shift'] as const)(
    'fails closed when the scoped %s lock finds no row',
    async (missing) => {
      const { service, tx } = setup();
      tx.$queryRaw.mockReset();
      tx.$queryRaw.mockResolvedValueOnce(
        missing === 'employee' ? [] : [{ id: 'emp' }],
      );
      tx.$queryRaw.mockResolvedValueOnce(
        missing === 'obligation' ? [] : [{ id: 'group' }],
      );
      tx.$queryRaw.mockResolvedValueOnce(
        missing === 'shift' ? [{ id: 's1' }] : [{ id: 's1' }, { id: 's2' }],
      );
      await expect(service.create(input, 'org', actor)).rejects.toThrow();
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
    },
  );
  it.each(['0', '-1', '1e2', '0.001', '1'.repeat(131073)])(
    'rejects invalid amount before transaction',
    async (amount) => {
      const { service, transaction } = setup();
      await expect(
        service.create({ ...input, amount }, 'org', actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['2024-02-30', '0000-01-01'])(
    'rejects invalid date before transaction',
    async (date) => {
      const { service, transaction } = setup();
      await expect(
        service.create({ ...input, date }, 'org', actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects unauthorized and cross-tenant actors before transaction', async () => {
    const { service, transaction } = setup();
    for (const who of [
      { ...actor, role: 'MEMBER' },
      { ...actor, organizationId: 'other' },
    ])
      await expect(
        service.create(input, 'org', who as RequestUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([
    'status',
    'kind',
    'released',
    'shared',
    'void',
    'duplicate',
    'cash',
    'unknown',
    'overpaid',
    'membership-change',
    'invalid-shift-precision',
    'overpayment',
  ] as const)('rejects %s history without writes', async (issue) => {
    const { service, tx, group, memberships } = setup();
    if (issue === 'status') group.status = 'COMPLETED';
    if (issue === 'kind') group.kind = 'FIXED_PERIOD';
    if (issue === 'released') memberships[0].releasedAt = new Date() as never;
    if (issue === 'shared')
      group.installments[0].outflow._count.installments = 2;
    if (issue === 'void')
      group.installments[0].allocations[0].voids.push({ id: 'v' });
    if (issue === 'duplicate')
      group.installments[0].allocations.push({
        ...group.installments[0].allocations[0],
        id: 'a2',
      });
    if (issue === 'cash') group.installments[0].outflow.amount = decimal('6');
    if (issue === 'unknown')
      group.installments[0].allocations[0].membershipId = 'missing';
    if (issue === 'overpaid') {
      group.installments[0].allocations[0].amount = decimal('11');
      group.installments[0].outflow.amount = decimal('11');
    }
    if (issue === 'invalid-shift-precision')
      memberships[0].shift.amount = decimal('20.001');
    if (issue === 'membership-change')
      tx.payrollShiftMembership.findMany
        .mockReset()
        .mockResolvedValueOnce([{ id: 'm1', shiftId: 's1' }])
        .mockResolvedValueOnce(memberships);
    await expect(
      service.create(
        issue === 'overpayment' ? { ...input, amount: '25.01' } : input,
        'org',
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
    expect(tx.payrollInstallment.create).not.toHaveBeenCalled();
    expect(tx.payrollAllocation.createMany).not.toHaveBeenCalled();
    expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
  });
  it('pays a current group despite an older released membership without changing historical facts', async () => {
    const { service, tx, memberships, group } = setup();
    const released = {
      id: 'prior-membership',
      shiftId: 's2',
      obligationId: 'prior-group',
      releasedAt: new Date('2023-12-01T00:00:00Z'),
      allocations: [],
    };
    const before = JSON.stringify({
      released,
      installments: group.installments,
    });
    tx.payrollShiftMembership.findMany
      .mockReset()
      .mockResolvedValueOnce(
        memberships.map(({ id, shiftId }) => ({ id, shiftId })),
      )
      .mockResolvedValueOnce([...memberships, released]);

    await expect(service.create(input, 'org', actor)).resolves.toMatchObject({
      paid: '17.00',
      balance: '13.00',
      status: 'PENDING',
    });
    expect(JSON.stringify({ released, installments: group.installments })).toBe(
      before,
    );
    expect(tx.payrollShiftMembership.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        organizationId: 'org',
        employeeId: 'emp',
        shiftId: { in: ['s1', 's2'] },
      },
      select: {
        id: true,
        shiftId: true,
        obligationId: true,
        releasedAt: true,
        allocations: {
          take: 1,
          select: { id: true, voids: { take: 1, select: { id: true } } },
        },
      },
    });
    expect(tx.payrollCashOutflow.create).toHaveBeenCalledTimes(1);
    expect(tx.payrollInstallment.create).toHaveBeenCalledTimes(1);
    expect(tx.payrollAllocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: 'org',
          employeeId: 'emp',
          obligationId: 'group',
          installmentId: 'new',
          membershipId: 'm2',
          amount: decimal('12'),
        },
      ],
    });
  });
  it.each([false, true])(
    'rejects a released membership with a historical allocation (voided: %s)',
    async (voided) => {
      const { service, tx, memberships } = setup();
      const released = {
        id: 'prior-membership',
        shiftId: 's2',
        obligationId: 'prior-group',
        releasedAt: new Date('2023-12-01T00:00:00Z'),
        allocations: [
          { id: 'prior-allocation', voids: voided ? [{ id: 'void' }] : [] },
        ],
      };
      tx.payrollShiftMembership.findMany
        .mockReset()
        .mockResolvedValueOnce(
          memberships.map(({ id, shiftId }) => ({ id, shiftId })),
        )
        .mockResolvedValueOnce([...memberships, released]);
      await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
      expect(tx.payrollInstallment.create).not.toHaveBeenCalled();
      expect(tx.payrollAllocation.createMany).not.toHaveBeenCalled();
      expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each([
    'current-release',
    'foreign-active',
    'duplicate-active',
    'void',
    'shared',
  ] as const)(
    'still rejects %s when an older released membership exists',
    async (issue) => {
      const { service, tx, memberships, group } = setup();
      const released = {
        id: 'prior-membership',
        shiftId: 's2',
        obligationId: 'prior-group',
        releasedAt: new Date('2023-12-01T00:00:00Z'),
        allocations: [],
      };
      const claims: unknown[] = [...memberships, released];
      if (issue === 'current-release')
        memberships[0].releasedAt = new Date('2024-01-01T00:00:00Z') as never;
      if (issue === 'foreign-active' || issue === 'duplicate-active')
        claims.push({
          ...memberships[0],
          id: 'extra',
          obligationId: issue === 'foreign-active' ? 'other-group' : 'group',
        });
      if (issue === 'void')
        group.installments[0].allocations[0].voids.push({ id: 'v' });
      if (issue === 'shared')
        group.installments[0].outflow._count.installments = 2;
      tx.payrollShiftMembership.findMany
        .mockReset()
        .mockResolvedValueOnce(
          memberships.map(({ id, shiftId }) => ({ id, shiftId })),
        )
        .mockResolvedValueOnce(claims);
      await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
      expect(tx.payrollInstallment.create).not.toHaveBeenCalled();
      expect(tx.payrollAllocation.createMany).not.toHaveBeenCalled();
      expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
    },
  );
  it('fails closed when another membership refers to a selected shift', async () => {
    const { service, tx, memberships } = setup();
    tx.payrollShiftMembership.findMany
      .mockReset()
      .mockResolvedValueOnce(
        memberships.map(({ id, shiftId }) => ({ id, shiftId })),
      )
      .mockResolvedValueOnce([
        ...memberships,
        { ...memberships[0], id: 'other', obligationId: 'other' },
      ]);
    await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.payrollCashOutflow.create).not.toHaveBeenCalled();
  });
  it.each(['allocation', 'status'] as const)(
    'rejects incomplete %s writes',
    async (boundary) => {
      const { service, tx } = setup();
      if (boundary === 'allocation')
        tx.payrollAllocation.createMany.mockResolvedValueOnce({ count: 0 });
      else tx.payrollObligation.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.create(input, 'org', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      if (boundary === 'allocation')
        expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(['outflow', 'installment', 'allocation', 'status'] as const)(
    'propagates %s write failure and does not call later writes',
    async (boundary) => {
      const { service, tx } = setup();
      const writes = [
        tx.payrollCashOutflow.create,
        tx.payrollInstallment.create,
        tx.payrollAllocation.createMany,
        tx.payrollObligation.updateMany,
      ];
      const index = ['outflow', 'installment', 'allocation', 'status'].indexOf(
        boundary,
      );
      const error = new Error('write failed');
      writes[index].mockRejectedValueOnce(error);
      await expect(service.create(input, 'org', actor)).rejects.toBe(error);
      writes.forEach((write, i) =>
        expect(write).toHaveBeenCalledTimes(i <= index ? 1 : 0),
      );
    },
  );

  // S5/S8: the group path writes the same optional expense inside its own
  // completing transaction. Mocks prove ordering and requested effects only; real
  // rollback and PostgreSQL locking stay unverified.
  describe('completion expense', () => {
    it('creates the expense, its payment mirrors and the payroll link in the same transaction', async () => {
      const { service, tx, group } = setup();
      group.expenseEnabled = true;

      await expect(
        service.create({ ...input, amount: '25' }, 'org', actor),
      ).resolves.toMatchObject({ status: 'COMPLETED' });

      expect(transactionCount(tx)).toBe(5);
      expect(tx.$queryRaw.mock.calls[3][0].join('?')).toMatch(
        /FROM "Organization"[\s\S]*FOR UPDATE/,
      );
      expect(tx.$queryRaw.mock.calls[4][0].join('?')).toMatch(
        /FROM "ExpenseLabel"[\s\S]*FOR UPDATE/,
      );
      expect(tx.$queryRaw.mock.calls[3].slice(1)).toEqual(['org']);
      // Employee, obligation and shift locks all precede the tenant lock.
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.$queryRaw.mock.invocationCallOrder[3],
      );
      expect(tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
        tx.$queryRaw.mock.invocationCallOrder[3],
      );
      expect(tx.payrollExpenseCategory.findUnique).toHaveBeenCalledWith({
        where: { organizationId: 'org' },
      });
      expect(tx.expense.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org',
          labelId: 'lbl',
          description: null,
          date: new Date('2024-02-29T05:00:00.000Z'),
          total: decimal('30.00'),
          status: 'PAID',
          createdById: 'user',
          payments: {
            create: [
              {
                organizationId: 'org',
                amount: decimal('5.00'),
                method: 'CASH',
                date: new Date('2024-01-15T05:00:00.000Z'),
              },
              {
                organizationId: 'org',
                amount: decimal('25.00'),
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
      expect(tx.expense.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.payrollObligation.updateMany.mock.invocationCallOrder[0],
      );
    });

    it.each([
      ['disabled', false],
      ['unknown', null],
    ])(
      'writes no expense and resolves no category when the choice is %s',
      async (_case, choice) => {
        const { service, tx, group } = setup();
        group.expenseEnabled = choice;

        await expect(
          service.create({ ...input, amount: '25' }, 'org', actor),
        ).resolves.toMatchObject({ status: 'COMPLETED' });

        expect(tx.expense.create).not.toHaveBeenCalled();
        expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
        expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
        expect(transactionCount(tx)).toBe(3);
        expect(tx.payrollObligation.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { status: 'COMPLETED', version: { increment: 1 } },
          }),
        );
      },
    );

    it('writes no expense while the payment is not completed', async () => {
      const { service, tx, group } = setup();
      group.expenseEnabled = true;

      await expect(service.create(input, 'org', actor)).resolves.toMatchObject({
        status: 'PENDING',
      });

      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(transactionCount(tx)).toBe(3);
    });

    it('fails the whole completion above the expense limit without expense or status writes', async () => {
      const { service, tx, memberships, group } = setup();
      group.expenseEnabled = true;
      group.installments.length = 0;
      memberships[0].shift.amount = decimal('9999999999.99');
      memberships[1].shift.amount = decimal('9999999999.99');

      await expect(
        service.create({ ...input, amount: '19999999999.98' }, 'org', actor),
      ).rejects.toThrow(
        'El gasto de nómina supera $9.999.999.999,99; el pago no se puede completar con gasto',
      );

      expect(tx.payrollExpenseCategory.findUnique).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.payrollObligationExpense.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(tx.payrollObligation.updateMany).not.toHaveBeenCalled();
      // The mock has no rollback: it only proves the failed completion never
      // requests the later writes. Real rollback of cash/allocations needs
      // PostgreSQL.
      expect(tx.payrollCashOutflow.create).toHaveBeenCalledTimes(1);
      expect(tx.payrollAllocation.createMany).toHaveBeenCalledTimes(1);
    });
  });
});
