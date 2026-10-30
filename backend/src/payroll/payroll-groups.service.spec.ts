import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PayrollObligationKind,
  PayrollObligationStatus,
} from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { PayrollGroupsService } from './payroll-groups.service';

const owner = {
  userId: 'u',
  organizationId: 'org',
  role: 'OWNER',
  isSuperAdmin: false,
} as RequestUser;
const input = { employeeId: 'emp', shiftIds: ['s1', 's2'] };

// This mock models commit/rollback, not PostgreSQL locks, indexes or isolation.
function setup() {
  const committed: unknown[] = [];
  const tx = {
    $queryRaw: jest
      .fn<
        Promise<{ id: string; active: boolean }[]>,
        [TemplateStringsArray | Prisma.Sql, ...unknown[]]
      >()
      .mockResolvedValue([{ id: 'emp', active: true }]),
    employeeShift: {
      findMany: jest.fn().mockResolvedValue([
        { id: 's1', amount: new Prisma.Decimal('0.01') },
        { id: 's2', amount: new Prisma.Decimal('100') },
      ]),
    },
    payrollShiftMembership: { findFirst: jest.fn().mockResolvedValue(null) },
    payrollObligation: {
      create: jest.fn().mockResolvedValue({
        id: 'group',
        kind: 'SHIFT_GROUP',
        status: 'PENDING',
      }),
    },
  };
  const transaction = jest.fn(
    async (fn: (t: typeof tx) => Promise<unknown>) => {
      const result = await fn(tx);
      committed.push(result);
      return result;
    },
  );
  const service = new PayrollGroupsService({
    $transaction: transaction,
  } as unknown as PrismaService);
  return { service, tx, transaction, committed };
}

describe('PayrollGroupsService', () => {
  it('locks scoped shifts in id order after the employee and before rereading and checking membership', async () => {
    const { service, tx } = setup();
    await service.create({ ...input, shiftIds: ['s2', 's1'] }, 'org', owner);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const [query] = tx.$queryRaw.mock.calls[1] as [Prisma.Sql];
    expect(query.sql).toMatch(
      /FROM "EmployeeShift"[\s\S]*"organizationId"\s*=\s*\?[\s\S]*"employeeId"\s*=\s*\?[\s\S]*"id" IN\s*\(\?,\?\)[\s\S]*ORDER BY "id"[\s\S]*FOR UPDATE/,
    );
    expect(query.values).toEqual(['org', 'emp', 's1', 's2']);
    const [employeeLock, shiftLock] = tx.$queryRaw.mock.invocationCallOrder;
    expect(employeeLock).toBeLessThan(shiftLock);
    expect(shiftLock).toBeLessThan(
      tx.employeeShift.findMany.mock.invocationCallOrder[0],
    );
    expect(tx.employeeShift.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.payrollShiftMembership.findFirst.mock.invocationCallOrder[0],
    );
    expect(
      tx.payrollShiftMembership.findFirst.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.payrollObligation.create.mock.invocationCallOrder[0]);
  });

  it('validates the post-lock shift read and does not write when it became invalid', async () => {
    const { service, tx, committed } = setup();
    tx.employeeShift.findMany.mockImplementationOnce(() => {
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      return Promise.resolve([
        { id: 's1', amount: new Prisma.Decimal('1') },
        { id: 's2', amount: new Prisma.Decimal('0') },
      ]);
    });
    await expect(service.create(input, 'org', owner)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.payrollShiftMembership.findFirst).not.toHaveBeenCalled();
    expect(tx.payrollObligation.create).not.toHaveBeenCalled();
    expect(committed).toHaveLength(0);
  });

  it.each(['OWNER', 'ADMIN'])(
    'creates a pending group and all selected memberships for %s',
    async (role) => {
      const { service, tx, transaction, committed } = setup();
      await expect(
        service.create(input, 'org', { ...owner, role } as RequestUser),
      ).resolves.toMatchObject({ id: 'group', status: 'PENDING' });
      expect(transaction).toHaveBeenCalledTimes(1);
      const [sql, employeeId, organizationId] = tx.$queryRaw.mock.calls[0];
      expect((sql as TemplateStringsArray).join('?')).toContain('FOR UPDATE');
      expect([employeeId, organizationId]).toEqual(['emp', 'org']);
      expect(tx.employeeShift.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: input.shiftIds },
          organizationId: 'org',
          employeeId: 'emp',
        },
        select: { id: true, amount: true },
      });
      expect(tx.payrollShiftMembership.findFirst).toHaveBeenCalledWith({
        where: { shiftId: { in: input.shiftIds }, releasedAt: null },
        select: { id: true },
      });
      expect(tx.payrollObligation.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org',
          employeeId: 'emp',
          kind: PayrollObligationKind.SHIFT_GROUP,
          status: PayrollObligationStatus.PENDING,
          // An omitted choice is stored as unspecified, never as a default.
          expenseEnabled: null,
          selectedExpenseDate: null,
          shiftMemberships: {
            create: input.shiftIds.map((shiftId) => ({
              shift: {
                connect: {
                  id_organizationId_employeeId: {
                    id: shiftId,
                    organizationId: 'org',
                    employeeId: 'emp',
                  },
                },
              },
            })),
          },
        },
        include: { shiftMemberships: true },
      });
      expect(committed).toHaveLength(1);
    },
  );

  it.each([
    undefined,
    { ...owner, userId: '' },
    { ...owner, organizationId: 'other' },
    ...['MEMBER', 'CASHIER', 'INVENTORY_USER', 'SUPER_ADMIN'].map((role) => ({
      ...owner,
      role,
    })),
  ])('rejects unauthorized actors before transaction', async (actor) => {
    const { service, transaction, committed } = setup();
    await expect(
      service.create(input, 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
    expect(committed).toHaveLength(0);
  });

  it.each([
    { ...input, shiftIds: [] },
    { ...input, shiftIds: ['s1', 's1'] },
    { ...input, shiftIds: [''] },
    { ...input, employeeId: '' },
    { ...input, expenseEnabled: 'true' },
    { ...input, expenseEnabled: 1 },
    { ...input, expenseEnabled: 'false' },
    { ...input, selectedExpenseDate: '2023-02-29' },
    { ...input, selectedExpenseDate: '2024-03-31T00:00:00Z' },
    { ...input, selectedExpenseDate: '2024-03-31 ' },
    { ...input, selectedExpenseDate: 20240331 },
    { ...input, extra: true },
  ])('rejects invalid selection without writes', async (bad) => {
    const { service, transaction } = setup();
    await expect(service.create(bad, 'org', owner)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects missing or inactive employees under the employee lock', async () => {
    for (const [rows, error] of [
      [[], NotFoundException],
      [[{ id: 'emp', active: false }], ConflictException],
    ] as const) {
      const { service, tx, committed } = setup();
      tx.$queryRaw.mockResolvedValueOnce([...rows]);
      await expect(service.create(input, 'org', owner)).rejects.toBeInstanceOf(
        error,
      );
      expect(tx.employeeShift.findMany).not.toHaveBeenCalled();
      expect(tx.payrollObligation.create).not.toHaveBeenCalled();
      expect(committed).toHaveLength(0);
    }
  });

  it('rejects missing, foreign-tenant or other-employee shifts without creating a group', async () => {
    const { service, tx, committed } = setup();
    tx.employeeShift.findMany.mockResolvedValueOnce([{ id: 's1' }]);
    await expect(service.create(input, 'org', owner)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.payrollObligation.create).not.toHaveBeenCalled();
    expect(committed).toHaveLength(0);
  });

  it('rejects a selected legacy zero-value shift without committing a group', async () => {
    const { service, tx, committed } = setup();
    tx.employeeShift.findMany.mockResolvedValueOnce([
      { id: 's1', amount: new Prisma.Decimal('100') },
      { id: 's2', amount: new Prisma.Decimal('0') },
    ]);
    await expect(service.create(input, 'org', owner)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.payrollObligation.create).not.toHaveBeenCalled();
    expect(committed).toHaveLength(0);
  });

  it.each(['-1', 'NaN', 'Infinity', '0.001', '10000000000'])(
    'rejects invalid stored shift amount %s without writes',
    async (amount) => {
      const { service, tx, committed } = setup();
      tx.employeeShift.findMany.mockResolvedValueOnce([
        { id: 's1', amount: new Prisma.Decimal(amount) },
        { id: 's2', amount: new Prisma.Decimal('1') },
      ]);
      await expect(service.create(input, 'org', owner)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.payrollObligation.create).not.toHaveBeenCalled();
      expect(committed).toHaveLength(0);
    },
  );

  it('rejects already claimed shifts without creating a group', async () => {
    const { service, tx, committed } = setup();
    tx.payrollShiftMembership.findFirst.mockResolvedValueOnce({ id: 'link' });
    await expect(service.create(input, 'org', owner)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.payrollObligation.create).not.toHaveBeenCalled();
    expect(committed).toHaveLength(0);
  });

  it.each([true, false])(
    'persists the explicit %s expense choice with its selected date',
    async (expenseEnabled) => {
      const { service, tx } = setup();
      await service.create(
        { ...input, expenseEnabled, selectedExpenseDate: '2024-02-29' },
        'org',
        owner,
      );
      expect(tx.payrollObligation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expenseEnabled,
          selectedExpenseDate: new Date('2024-02-29T00:00:00.000Z'),
        }),
        include: { shiftMemberships: true },
      });
    },
  );

  it('keeps an explicitly null expense choice unspecified', async () => {
    const { service, tx } = setup();
    await service.create(
      { ...input, expenseEnabled: null, selectedExpenseDate: null },
      'org',
      owner,
    );
    expect(tx.payrollObligation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expenseEnabled: null,
        selectedExpenseDate: null,
      }),
      include: { shiftMemberships: true },
    });
  });

  it('accepts a choice without a selected date and a date without a choice', async () => {
    for (const choice of [
      { expenseEnabled: false },
      { selectedExpenseDate: '2024-03-05' },
    ]) {
      const { service, tx } = setup();
      await service.create({ ...input, ...choice }, 'org', owner);
      expect(tx.payrollObligation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expenseEnabled: choice.expenseEnabled ?? null,
          selectedExpenseDate:
            choice.selectedExpenseDate === undefined
              ? null
              : new Date(`${choice.selectedExpenseDate}T00:00:00.000Z`),
        }),
        include: { shiftMemberships: true },
      });
    }
  });

  it.each([
    { ...owner, organizationId: 'other' },
    { ...owner, role: 'MEMBER' },
  ])(
    'does not let an expense choice relax authorization or tenant scope',
    async (actor) => {
      const { service, transaction, committed } = setup();
      await expect(
        service.create(
          { ...input, expenseEnabled: true, selectedExpenseDate: '2024-03-05' },
          'org',
          actor as RequestUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
      expect(committed).toHaveLength(0);
    },
  );

  it('translates the active-shift unique race and rolls back, without retry', async () => {
    const { service, tx, transaction, committed } = setup();
    tx.payrollObligation.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['shiftId'] },
      }),
    );
    await expect(service.create(input, 'org', owner)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(committed).toHaveLength(0);
  });

  it('translates serialization conflicts but propagates unrelated database errors', async () => {
    for (const code of ['P2034', 'P2003']) {
      const { service, tx, transaction, committed } = setup();
      const error = new Prisma.PrismaClientKnownRequestError('db', {
        code,
        clientVersion: 'test',
      });
      tx.payrollObligation.create.mockRejectedValueOnce(error);
      if (code === 'P2034')
        await expect(
          service.create(input, 'org', owner),
        ).rejects.toBeInstanceOf(ConflictException);
      else
        await expect(service.create(input, 'org', owner)).rejects.toBe(error);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(committed).toHaveLength(0);
    }
  });
});
