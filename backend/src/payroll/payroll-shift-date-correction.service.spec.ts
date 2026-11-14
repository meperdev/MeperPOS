import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PayrollObligationStatus } from '@prisma/client';
import { PayrollShiftDateCorrectionService } from './payroll-shift-date-correction.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';

const actor = {
  userId: 'user',
  organizationId: 'org',
  role: 'OWNER',
} as RequestUser;
const membership = {
  id: 'member',
  obligationId: 'obligation',
  releasedAt: null,
  obligation: { status: PayrollObligationStatus.PENDING },
};

describe('PayrollShiftDateCorrectionService', () => {
  let tx: any;
  let service: PayrollShiftDateCorrectionService;
  beforeEach(() => {
    tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'employee', active: true }])
        .mockResolvedValue([{ id: 'x' }]),
      employeeShift: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'shift',
          employeeId: 'employee',
          amount: new Prisma.Decimal(100),
          date: new Date('2025-01-15T00:00:00.000Z'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payrollShiftMembership: {
        findMany: jest.fn().mockResolvedValue([membership]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new PayrollShiftDateCorrectionService({
      $transaction: (fn: any) => fn(tx),
    } as PrismaService);
  });
  const correct = (input: unknown = { date: '2025-02-03' }) =>
    service.correct('shift', input, 'org', actor);

  it('changes only date while retaining pending membership and allocation identities', async () => {
    await correct();
    expect(tx.employeeShift.updateMany).toHaveBeenCalledWith({
      where: { id: 'shift', organizationId: 'org', employeeId: 'employee' },
      data: { date: new Date('2025-02-03T00:00:00.000Z') },
    });
    expect(tx.payrollShiftMembership.findMany).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });
  it('records exact locked old and new dates with the actor and tenant after updating', async () => {
    await correct();
    expect(tx.employeeShift.findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: 'shift', organizationId: 'org', employeeId: 'employee' },
      select: { id: true, amount: true, date: true },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user',
        organizationId: 'org',
        action: 'PAYROLL_SHIFT_DATE_CORRECTION',
        resource: 'EmployeeShift',
        resourceId: 'shift',
        metadata: { oldDate: '2025-01-15', newDate: '2025-02-03' },
      },
    });
    expect(
      tx.employeeShift.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.auditLog.create.mock.invocationCallOrder[0]);
  });
  it('does not update or audit a same-date correction after validation', async () => {
    await correct({ date: '2025-01-15' });
    expect(tx.payrollShiftMembership.findMany).toHaveBeenCalledTimes(2);
    expect(tx.employeeShift.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('still rejects a same-date correction for completed history', async () => {
    tx.payrollShiftMembership.findMany.mockResolvedValue([
      {
        ...membership,
        obligation: { status: PayrollObligationStatus.COMPLETED },
      },
    ]);
    await expect(correct({ date: '2025-01-15' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.employeeShift.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('propagates audit failures after attempting the update', async () => {
    const error = new Error('audit failed');
    tx.auditLog.create.mockRejectedValue(error);
    await expect(correct()).rejects.toBe(error);
    expect(tx.employeeShift.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('propagates Prisma audit errors without treating them as shift conflicts', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('audit', {
      code: 'P2034',
      clientVersion: 'test',
    });
    tx.auditLog.create.mockRejectedValue(error);
    await expect(correct()).rejects.toBe(error);
  });
  it('propagates audit-origin P2002 unchanged even with a date-index target', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('audit', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: 'EmployeeShift_organizationId_employeeId_date_key' },
    });
    tx.auditLog.create.mockRejectedValue(error);
    await expect(correct()).rejects.toBe(error);
    expect(tx.employeeShift.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('maps an update-origin P2034 to conflict without auditing', async () => {
    tx.employeeShift.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('transaction conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('maps a transaction-origin P2034 to conflict', async () => {
    service = new PayrollShiftDateCorrectionService({
      $transaction: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('transaction conflict', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      ),
    } as unknown as PrismaService);
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not audit a failed shift update', async () => {
    tx.employeeShift.updateMany.mockResolvedValue({ count: 0 });
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('requests employee, obligation, then shift locks with tenant scoping', async () => {
    await correct();
    const calls = tx.$queryRaw.mock.calls;
    const sql = (call: any[]) =>
      Array.isArray(call[0]) ? call[0].join('?') : call[0].sql;
    expect(sql(calls[0])).toContain('FROM "Employee"');
    expect(sql(calls[1])).toContain('FROM "PayrollObligation"');
    expect(sql(calls[2])).toContain('FROM "EmployeeShift"');
    for (const call of calls) {
      expect(sql(call)).toContain('"organizationId"');
      expect(sql(call)).toContain('FOR UPDATE');
    }
  });
  it('allows an ungrouped shift', async () => {
    tx.payrollShiftMembership.findMany.mockResolvedValue([]);
    await correct();
    expect(tx.employeeShift.updateMany).toHaveBeenCalledTimes(1);
  });
  it.each([
    [
      'completed',
      {
        ...membership,
        obligation: { status: PayrollObligationStatus.COMPLETED },
      },
    ],
    ['released', { ...membership, releasedAt: new Date() }],
  ])('rejects %s history', async (_label, member) => {
    tx.payrollShiftMembership.findMany.mockResolvedValue([member]);
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.employeeShift.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('rereads status and membership after locks', async () => {
    tx.payrollShiftMembership.findMany
      .mockResolvedValueOnce([membership])
      .mockResolvedValueOnce([
        {
          ...membership,
          obligation: { status: PayrollObligationStatus.COMPLETED },
        },
      ]);
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('fails closed if membership changes while acquiring locks', async () => {
    tx.payrollShiftMembership.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([membership]);
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects inactive employees and legacy zero amounts', async () => {
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: 'employee', active: false }]);
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
    tx.$queryRaw
      .mockReset()
      .mockResolvedValue([{ id: 'employee', active: true }]);
    tx.employeeShift.findFirst.mockResolvedValue({
      id: 'shift',
      employeeId: 'employee',
      amount: new Prisma.Decimal(0),
    });
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects invalid input and unauthorized actors before transaction', async () => {
    await expect(correct({ date: '2025-02-30' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      correct({ date: '2025-01-01', amount: 3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.correct('shift', { date: '2025-01-01' }, 'other', actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('rejects missing shifts', async () => {
    tx.employeeShift.findFirst.mockResolvedValue(null);
    await expect(correct()).rejects.toBeInstanceOf(NotFoundException);
  });
  it('does not mask unrelated database errors', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('other', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['other'] },
    });
    tx.employeeShift.updateMany.mockRejectedValue(error);
    await expect(correct()).rejects.toBe(error);
  });
  it('maps the named date uniqueness index conflict without auditing', async () => {
    tx.employeeShift.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'EmployeeShift_organizationId_employeeId_date_key' },
      }),
    );
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('maps only the date uniqueness conflict', async () => {
    tx.employeeShift.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['organizationId', 'employeeId', 'date'] },
      }),
    );
    await expect(correct()).rejects.toBeInstanceOf(ConflictException);
  });
});
