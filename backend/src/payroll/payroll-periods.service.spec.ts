import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollObligationKind,
  PayrollObligationStatus,
  Prisma,
} from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { PayrollPeriodsService } from './payroll-periods.service';

const owner = {
  userId: 'u',
  organizationId: 'org',
  role: 'OWNER',
  isSuperAdmin: false,
} as RequestUser;
const input = {
  employeeId: 'emp',
  periodStart: '2024-02-29',
  periodEnd: '2024-03-31',
  periodAmount: '123.45',
};

// Models transaction completion only; it does not simulate PostgreSQL locks or rollback.
function setup() {
  const committed: unknown[] = [];
  const tx = {
    $queryRaw: jest
      .fn<
        Promise<{ id: string; active: boolean }[]>,
        [TemplateStringsArray, ...unknown[]]
      >()
      .mockResolvedValue([{ id: 'emp', active: true }]),
    payrollObligation: {
      create: jest.fn().mockResolvedValue({ id: 'period', status: 'PENDING' }),
    },
  };
  const transaction = jest.fn(
    async (fn: (client: typeof tx) => Promise<unknown>) => {
      const result = await fn(tx);
      committed.push(result);
      return result;
    },
  );
  const service = new PayrollPeriodsService({
    $transaction: transaction,
  } as unknown as PrismaService);
  return { service, tx, transaction, committed };
}

describe('PayrollPeriodsService', () => {
  it.each(['OWNER', 'ADMIN'])(
    'creates a manually specified pending period for %s under a tenant employee lock',
    async (role) => {
      const { service, tx, committed } = setup();
      await expect(
        service.create(input, 'org', { ...owner, role } as RequestUser),
      ).resolves.toMatchObject({ id: 'period', status: 'PENDING' });
      const [sql, employeeId, organizationId] = tx.$queryRaw.mock.calls[0];
      expect(sql.join('?')).toMatch(
        /FROM "Employee"[\s\S]*"id"\s*=\s*\?[\s\S]*"organizationId"\s*=\s*\?[\s\S]*FOR UPDATE/,
      );
      expect([employeeId, organizationId]).toEqual(['emp', 'org']);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.payrollObligation.create.mock.invocationCallOrder[0],
      );
      expect(tx.payrollObligation.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org',
          employeeId: 'emp',
          kind: PayrollObligationKind.FIXED_PERIOD,
          status: PayrollObligationStatus.PENDING,
          periodStart: new Date('2024-02-29T00:00:00.000Z'),
          periodEnd: new Date('2024-03-31T00:00:00.000Z'),
          periodAmount: new Prisma.Decimal('123.45'),
        },
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
    const { service, transaction } = setup();
    await expect(
      service.create(input, 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { ...input, employeeId: ' ' },
    { ...input, employeeId: 'x'.repeat(201) },
    { ...input, periodStart: '2023-02-29' },
    { ...input, periodStart: '0000-01-01' },
    { ...input, periodEnd: '2024-03-31T00:00:00Z' },
    { ...input, periodEnd: '2024-02-28' },
    ...['0', '-1', '0.001', '1e2', '', 'NaN', 123.45].map((periodAmount) => ({
      ...input,
      periodAmount,
    })),
    { ...input, extra: true },
  ])('rejects invalid data without transaction: %j', async (bad) => {
    const { service, transaction } = setup();
    await expect(service.create(bad, 'org', owner)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    [[], NotFoundException],
    [[{ id: 'emp', active: false }], ConflictException],
  ] as const)(
    'rejects missing/foreign or inactive employee after lock',
    async (rows, error) => {
      const { service, tx, committed } = setup();
      tx.$queryRaw.mockResolvedValueOnce([...rows]);
      await expect(service.create(input, 'org', owner)).rejects.toBeInstanceOf(
        error,
      );
      expect(tx.payrollObligation.create).not.toHaveBeenCalled();
      expect(committed).toHaveLength(0);
    },
  );

  it('rejects decimal strings exceeding the PostgreSQL numeric input limit before a transaction', async () => {
    const { service, transaction } = setup();
    await expect(
      service.create(
        { ...input, periodAmount: '1'.repeat(131073) },
        'org',
        owner,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('preserves a period amount above the shift limit', async () => {
    const { service, tx } = setup();
    await service.create(
      { ...input, periodAmount: '10000000000.01' },
      'org',
      owner,
    );
    expect(tx.payrollObligation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        periodAmount: new Prisma.Decimal('10000000000.01'),
      }),
    });
  });

  it.each(['0.01', '9999999999.99', '00000000001'])(
    'accepts amount boundary %s and a same-day period',
    async (periodAmount) => {
      const { service, tx } = setup();
      await service.create(
        { ...input, periodEnd: input.periodStart, periodAmount },
        'org',
        owner,
      );
      expect(tx.payrollObligation.create).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates database errors and does not commit', async () => {
    const { service, tx, committed } = setup();
    const error = new Error('database failure');
    tx.payrollObligation.create.mockRejectedValueOnce(error);
    await expect(service.create(input, 'org', owner)).rejects.toBe(error);
    expect(committed).toHaveLength(0);
  });
});
