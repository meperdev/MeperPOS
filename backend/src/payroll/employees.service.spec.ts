import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { EmployeeModality } from './dto/employee.dto';

const owner = {
  userId: 'user',
  role: 'OWNER',
  organizationId: 'org',
  isSuperAdmin: false,
} as RequestUser;
const admin = { ...owner, role: 'ADMIN' } as RequestUser;

function setup() {
  const employee = {
    create: jest.fn().mockResolvedValue({ id: 'employee', name: 'Ana' }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest
      .fn()
      .mockResolvedValue({ id: 'employee', organizationId: 'org' }),
    updateManyAndReturn: jest
      .fn()
      .mockResolvedValue([
        { id: 'employee', organizationId: 'org', name: 'Nueva' },
      ]),
  };
  // SAFETY: The mocked delegate implements all Prisma methods exercised here.
  const service = new EmployeesService({
    employee,
  } as unknown as PrismaService);
  return { service, employee };
}

describe('EmployeesService', () => {
  it('creates a tenant-scoped profile without a login', async () => {
    const { service, employee } = setup();
    const dto = {
      name: 'Ana',
      identification: '123',
      phone: '555',
      email: 'ana@example.com',
      address: 'Calle 1',
      jobTitle: 'Vendedora',
      startDate: '2025-01-02',
      remunerationModality: EmployeeModality.BY_DAY,
      referenceAmount: 25000,
    };
    await expect(service.create(dto, 'org', owner)).resolves.toEqual({
      id: 'employee',
      name: 'Ana',
    });
    expect(employee.create).toHaveBeenCalledWith({
      data: {
        ...dto,
        startDate: new Date('2025-01-02T00:00:00.000Z'),
        organizationId: 'org',
      },
    });
  });

  it('lists both statuses by default and filters inactive without crossing tenants', async () => {
    const { service, employee } = setup();
    await service.findAll({}, 'org', admin);
    expect(employee.findMany).toHaveBeenLastCalledWith({
      where: { organizationId: 'org' },
      orderBy: { name: 'asc' },
    });
    await service.findAll({ active: false }, 'org', admin);
    expect(employee.findMany).toHaveBeenLastCalledWith({
      where: { organizationId: 'org', active: false },
      orderBy: { name: 'asc' },
    });
  });

  it('reads details with tenant scope and hides missing or foreign employees', async () => {
    const { service, employee } = setup();
    await service.findOne('employee', 'org', owner);
    expect(employee.findFirst).toHaveBeenCalledWith({
      where: { id: 'employee', organizationId: 'org' },
    });
    employee.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.findOne('foreign', 'org', owner),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the updated row rather than a later concurrent read', async () => {
    const { service, employee } = setup();
    employee.findFirst.mockResolvedValue({
      id: 'employee',
      organizationId: 'org',
      name: 'Later',
    });
    await expect(
      service.update('employee', { name: 'Nueva' }, 'org', admin),
    ).resolves.toEqual({
      id: 'employee',
      organizationId: 'org',
      name: 'Nueva',
    });
    expect(employee.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'employee', organizationId: 'org' },
      data: { name: 'Nueva' },
    });
    expect(employee.findFirst).not.toHaveBeenCalled();
  });

  it('updates profile and clears optional fields without changing ownership', async () => {
    const { service, employee } = setup();
    await service.update(
      'employee',
      { phone: null, name: 'Nueva', startDate: null },
      'org',
      admin,
    );
    expect(employee.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'employee', organizationId: 'org' },
      data: { phone: null, name: 'Nueva', startDate: null },
    });
    expect(employee.findFirst).not.toHaveBeenCalled();
  });

  it('deactivates and reactivates without deleting history', async () => {
    const { service, employee } = setup();
    for (const active of [false, true]) {
      const updated = { id: 'employee', organizationId: 'org', active };
      employee.updateManyAndReturn.mockResolvedValueOnce([updated]);
      await expect(
        service.setActive('employee', active, 'org', owner),
      ).resolves.toEqual(updated);
      expect(employee.updateManyAndReturn).toHaveBeenLastCalledWith({
        where: { id: 'employee', organizationId: 'org' },
        data: { active },
      });
    }
    expect(employee.findFirst).not.toHaveBeenCalled();
  });

  it('rejects foreign or absent targets on both mutation paths', async () => {
    const { service, employee } = setup();
    employee.updateManyAndReturn.mockResolvedValue([]);
    await expect(
      service.update('foreign', { name: 'A' }, 'org', owner),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.setActive('foreign', false, 'org', owner),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(employee.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { ...owner, organizationId: 'other' },
    { ...owner, userId: '' },
    { ...owner, role: 'MEMBER' },
    { ...owner, role: 'CASHIER' },
    { ...owner, role: 'INVENTORY_USER' },
    { ...owner, role: 'SUPER_ADMIN', isSuperAdmin: true },
  ])('rejects unauthorized actors on all operations', async (actor) => {
    const { service, employee } = setup();
    await expect(
      service.create({ name: 'Ana' }, 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.findAll({}, 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.findOne('id', 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.update('id', {}, 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.setActive('id', false, 'org', actor as RequestUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(employee.create).not.toHaveBeenCalled();
    expect(employee.findMany).not.toHaveBeenCalled();
    expect(employee.findFirst).not.toHaveBeenCalled();
    expect(employee.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('requires organization even for owners', async () => {
    const { service } = setup();
    await expect(service.findAll({}, undefined, owner)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([
    { name: '' },
    { name: '   ' },
    { name: 'Ana', startDate: '2025-02-30' },
    { name: 'Ana', referenceAmount: -1 },
    { name: 'Ana', referenceAmount: 1.234 },
    { name: 'Ana', remunerationModality: 'INVALID' },
    { name: 'Ana', organizationId: 'other' },
    { name: 'Ana', active: false },
    { name: 'Ana', email: 'bad' },
  ])('rejects invalid or overposted create data', async (dto) => {
    const { service, employee } = setup();
    await expect(
      service.create(dto as never, 'org', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(employee.create).not.toHaveBeenCalled();
  });

  it('rejects scientific-notation fractional reference amounts without throwing a TypeError', async () => {
    const { service, employee } = setup();
    await expect(
      service.create({ name: 'Ana', referenceAmount: 1e-7 }, 'org', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(employee.create).not.toHaveBeenCalled();
  });

  it.each([0, 0.01, 0.29, 1.01, 9999999999.99, null])(
    'accepts valid optional reference amount %s',
    async (referenceAmount) => {
      const { service } = setup();
      await expect(
        service.create({ name: 'Ana', referenceAmount }, 'org', owner),
      ).resolves.toBeDefined();
      await expect(
        service.update('employee', { referenceAmount }, 'org', owner),
      ).resolves.toBeDefined();
    },
  );

  it.each([-0.01, 0.001, 1.234, 1e-7, 1e-8, 10000000000, NaN, Infinity])(
    'rejects invalid reference amount %s on create and update',
    async (referenceAmount) => {
      const { service, employee } = setup();
      await expect(
        service.create({ name: 'Ana', referenceAmount }, 'org', owner),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.update('employee', { referenceAmount }, 'org', owner),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(employee.create).not.toHaveBeenCalled();
      expect(employee.updateManyAndReturn).not.toHaveBeenCalled();
    },
  );

  it('rejects null name, status overposting and invalid status values', async () => {
    const { service, employee } = setup();
    await expect(
      service.update('id', { name: null } as never, 'org', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('id', { active: false } as never, 'org', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setActive('id', 'false' as never, 'org', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.findAll({ active: null } as never, 'org', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(employee.updateManyAndReturn).not.toHaveBeenCalled();
  });
});
