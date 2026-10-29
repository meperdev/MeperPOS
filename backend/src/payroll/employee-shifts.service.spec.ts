import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeShiftKind, Prisma } from '@prisma/client';
import { EmployeeShiftsService } from './employee-shifts.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';

const owner = {
  userId: 'user',
  role: 'OWNER',
  organizationId: 'org',
  isSuperAdmin: false,
} as RequestUser;
const dto = {
  employeeId: 'emp',
  date: '2025-01-02',
  kind: EmployeeShiftKind.FULL_DAY,
  amount: 45000,
};
function setup() {
  const employee = {
    findFirst: jest.fn().mockResolvedValue({ id: 'emp', active: true }),
  };
  const employeeShift = {
    create: jest.fn().mockResolvedValue({ id: 'shift' }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue({ id: 'shift' }),
  };
  const service = new EmployeeShiftsService({
    employee,
    employeeShift,
  } as unknown as PrismaService);
  return { service, employee, employeeShift };
}

describe('EmployeeShiftsService', () => {
  it('creates manually priced full and partial shifts using UTC date-only values', async () => {
    const { service, employee, employeeShift } = setup();
    for (const kind of [
      EmployeeShiftKind.FULL_DAY,
      EmployeeShiftKind.PARTIAL_DAY,
    ]) {
      await expect(
        service.create({ ...dto, kind }, 'org', owner),
      ).resolves.toEqual({ id: 'shift' });
      expect(employeeShift.create).toHaveBeenLastCalledWith({
        data: {
          ...dto,
          kind,
          organizationId: 'org',
          date: new Date('2025-01-02T00:00:00.000Z'),
        },
      });
    }
    expect(employee.findFirst).toHaveBeenCalledWith({
      where: { id: 'emp', organizationId: 'org' },
      select: { id: true, active: true },
    });
  });

  it('persists and returns an optional observation on creation and reads', async () => {
    const { service, employeeShift } = setup();
    const shift = { id: 'shift', observation: 'Llegó tarde' };
    employeeShift.create.mockResolvedValueOnce(shift);
    employeeShift.findMany.mockResolvedValueOnce([shift]);
    employeeShift.findFirst.mockResolvedValueOnce(shift);
    await expect(
      service.create({ ...dto, observation: shift.observation }, 'org', owner),
    ).resolves.toEqual(shift);
    expect(employeeShift.create).toHaveBeenCalledWith({
      data: {
        ...dto,
        organizationId: 'org',
        date: new Date('2025-01-02T00:00:00.000Z'),
        observation: shift.observation,
      },
    });
    await expect(service.findAll('emp', 'org', owner)).resolves.toEqual([
      shift,
    ]);
    await expect(service.findOne('shift', 'org', owner)).resolves.toEqual(
      shift,
    );
  });

  it('accepts null observation and rejects non-string observations', async () => {
    const { service, employee, employeeShift } = setup();
    await service.create({ ...dto, observation: null }, 'org', owner);
    expect(employeeShift.create).toHaveBeenCalledWith({
      data: {
        ...dto,
        organizationId: 'org',
        date: new Date('2025-01-02T00:00:00.000Z'),
        observation: null,
      },
    });
    employee.findFirst.mockClear();
    await expect(
      service.create({ ...dto, observation: 42 } as never, 'org', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(employee.findFirst).not.toHaveBeenCalled();
  });

  it('reads scoped history, including for inactive employees, and hides foreign shifts', async () => {
    const { service, employee, employeeShift } = setup();
    const admin = { ...owner, role: 'ADMIN' } as RequestUser;
    await service.findAll('emp', 'org', admin);
    expect(employeeShift.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org', employeeId: 'emp' },
      orderBy: { date: 'asc' },
    });
    await service.findOne('shift', 'org', admin);
    expect(employeeShift.findFirst).toHaveBeenCalledWith({
      where: { id: 'shift', organizationId: 'org' },
    });
    employeeShift.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.findOne('foreign', 'org', admin),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(employee.findFirst).not.toHaveBeenCalled();
    await expect(
      service.findAll(undefined as never, 'org', admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.findOne(undefined as never, 'org', admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    undefined,
    { ...owner, userId: '' },
    { ...owner, organizationId: 'other' },
    ...['MEMBER', 'CASHIER', 'INVENTORY_USER', 'SUPER_ADMIN'].map((role) => ({
      ...owner,
      role,
    })),
  ])('rejects unauthorized actors for every operation', async (actor) => {
    const { service, employee, employeeShift } = setup();
    await expect(
      service.create(dto, 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.findAll('emp', 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.findOne('shift', 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(employee.findFirst).not.toHaveBeenCalled();
    expect(employeeShift.findMany).not.toHaveBeenCalled();
    expect(employeeShift.findFirst).not.toHaveBeenCalled();
  });

  it('requires an organization', async () => {
    await expect(
      setup().service.create(dto, undefined, owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    null,
    [],
    {},
    { ...dto, date: '2025-02-30' },
    { ...dto, date: '2025-01-02T00:00:00Z' },
    { ...dto, employeeId: ' ' },
    { ...dto, kind: 'OTHER' },
    { ...dto, amount: -1 },
    { ...dto, amount: 1.234 },
    { ...dto, amount: 10000000000 },
    { ...dto, amount: null },
    { ...dto, amount: '12' },
    { ...dto, organizationId: 'other' },
    { ...dto, unknownField: 'note' },
    { ...dto, total: 123 },
    { ...dto, rate: 123 },
  ])('rejects invalid or overposted input', async (input) => {
    const { service, employee } = setup();
    await expect(
      service.create(input as never, 'org', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(employee.findFirst).not.toHaveBeenCalled();
  });

  it('rejects scientific-notation fractional amounts without throwing a TypeError', async () => {
    const { service, employee, employeeShift } = setup();
    await expect(
      service.create({ ...dto, amount: 1e-7 }, 'org', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(employee.findFirst).not.toHaveBeenCalled();
    expect(employeeShift.create).not.toHaveBeenCalled();
  });

  it.each([0, 0.01, 0.29, 1.01, 9999999999.99])(
    'accepts valid amount %s',
    async (amount) => {
      const { service } = setup();
      await expect(
        service.create({ ...dto, amount }, 'org', owner),
      ).resolves.toBeDefined();
    },
  );

  it.each([-0.01, 0.001, 1.234, 1e-7, 1e-8, 10000000000, NaN, Infinity])(
    'rejects invalid amount %s before accessing the database',
    async (amount) => {
      const { service, employee, employeeShift } = setup();
      await expect(
        service.create({ ...dto, amount }, 'org', owner),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(employee.findFirst).not.toHaveBeenCalled();
      expect(employeeShift.create).not.toHaveBeenCalled();
    },
  );

  it('rejects missing, foreign and inactive employees before writing', async () => {
    const { service, employee, employeeShift } = setup();
    employee.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'emp', active: false });
    await expect(service.create(dto, 'org', owner)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.create(dto, 'org', owner)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(employeeShift.create).not.toHaveBeenCalled();
  });

  it('maps only the shift uniqueness guard and the inactive trigger, propagating unrelated errors', async () => {
    const { service, employeeShift } = setup();
    const known = (code: string, meta: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError('database detail', {
        code,
        clientVersion: 'test',
        meta,
      });
    const duplicate = known('P2002', {
      target: ['organizationId', 'employeeId', 'date'],
    });
    const inactive = new Prisma.PrismaClientUnknownRequestError(
      'database: Inactive employee cannot receive a shift',
      { clientVersion: 'test' },
    );
    const triggerKnown = known('P2004', {
      database_error: 'Inactive employee cannot receive a shift',
    });
    const unrelated = known('P2002', { target: ['id'] });
    for (const error of [duplicate, inactive, triggerKnown]) {
      employeeShift.create.mockRejectedValueOnce(error);
      const result = service.create(dto, 'org', owner);
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.not.toThrow('database detail');
    }
    employeeShift.create.mockRejectedValueOnce(unrelated);
    await expect(service.create(dto, 'org', owner)).rejects.toBe(unrelated);
  });
});
